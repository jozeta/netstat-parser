import os
import subprocess
import unittest

from npcollect.remote import (CollectError, MissingExtra, POSIX_SCRIPT, POWERSHELL_SCRIPT,
                              run_ssh, run_winrm, ssh_argv)
from npcollect.targets import Target

T = Target(host="10.0.5.12", method="ssh", line=1, user="root", key="~/.ssh/id_ed25519", port=2222)


class SshArgv(unittest.TestCase):
    def test_full(self):
        argv = ssh_argv(T, accept_new=False)
        self.assertEqual(argv[0], "ssh")
        self.assertIn("BatchMode=yes", argv)
        self.assertNotIn("StrictHostKeyChecking=accept-new", argv)
        self.assertEqual(argv[argv.index("-p") + 1], "2222")
        self.assertEqual(argv[argv.index("-i") + 1], os.path.expanduser("~/.ssh/id_ed25519"))
        self.assertIn("IdentitiesOnly=yes", argv)
        self.assertEqual(argv[argv.index("-l") + 1], "root")
        # host comes after "--" so it can never be read as an option, then the remote command
        self.assertEqual(argv[-4:], ["--", "10.0.5.12", "sh", "-s"])

    def test_minimal_and_accept_new(self):
        argv = ssh_argv(Target(host="[fe80::1%en0]", method="ssh", line=1), accept_new=True)
        self.assertIn("StrictHostKeyChecking=accept-new", argv)
        self.assertNotIn("-p", argv)
        self.assertNotIn("-i", argv)
        self.assertNotIn("-l", argv)
        self.assertEqual(argv[-3], "fe80::1%en0")


class RunSsh(unittest.TestCase):
    def test_feeds_script_on_stdin_and_returns_stdout(self):
        seen = {}

        def fake_run(argv, **kw):
            seen.update(kw, argv=argv)
            return subprocess.CompletedProcess(argv, 0, stdout=b"### netstat-parser v1\n", stderr=b"")

        out = run_ssh(T, accept_new=False, timeout=30, run=fake_run)
        self.assertEqual(out, b"### netstat-parser v1\n")
        self.assertEqual(seen["input"], POSIX_SCRIPT.encode())
        self.assertEqual(seen["timeout"], 30)
        self.assertNotIn("shell", seen)

    def test_failure_message_is_cleaned(self):
        def fake_run(argv, **kw):
            return subprocess.CompletedProcess(argv, 255, stdout=b"", stderr=b"\x1b[31mPermission denied\x07 (publickey).\r\n")

        with self.assertRaises(CollectError) as cm:
            run_ssh(T, accept_new=False, timeout=30, run=fake_run)
        self.assertEqual(str(cm.exception), "ssh exit 255: [31mPermission denied (publickey).")

    def test_timeout(self):
        def fake_run(argv, **kw):
            raise subprocess.TimeoutExpired(argv, kw["timeout"])

        with self.assertRaisesRegex(CollectError, "timed out after 30 s"):
            run_ssh(T, accept_new=False, timeout=30, run=fake_run)

    def test_too_large(self):
        def fake_run(argv, **kw):
            return subprocess.CompletedProcess(argv, 0, stdout=b"x" * 11, stderr=b"")

        with self.assertRaisesRegex(CollectError, "more than"):
            run_ssh(T, accept_new=False, timeout=30, run=fake_run, max_bytes=10)

    def test_missing_ssh_binary(self):
        def fake_run(argv, **kw):
            raise FileNotFoundError("ssh")

        with self.assertRaisesRegex(CollectError, "ssh client not found"):
            run_ssh(T, accept_new=False, timeout=30, run=fake_run)


class FakeClient:
    instances = []

    def __init__(self, server, **kw):
        self.server, self.kw = server, kw
        FakeClient.instances.append(self)

    def execute_ps(self, script):
        self.script = script
        return "### netstat-parser v1\r\nhostname: DC01", None, False


class RunWinrm(unittest.TestCase):
    def setUp(self):
        FakeClient.instances.clear()

    def test_client_arguments(self):
        t = Target(host="dc01.corp.local", method="winrm", line=1, user="admin", domain="CORP", port=5986)
        out = run_winrm(t, "s3cret", verify_tls=False, timeout=60, client_factory=FakeClient)
        self.assertEqual(out, "### netstat-parser v1\r\nhostname: DC01".encode("utf-8"))
        c = FakeClient.instances[0]
        self.assertEqual(c.server, "dc01.corp.local")
        self.assertEqual(c.kw["username"], "CORP\\admin")
        self.assertEqual(c.kw["password"], "s3cret")
        self.assertEqual(c.kw["port"], 5986)
        self.assertTrue(c.kw["ssl"])
        self.assertFalse(c.kw["cert_validation"])
        self.assertEqual(c.script, POWERSHELL_SCRIPT)

    def test_http_default_and_ipv6(self):
        t = Target(host="fd00::5", method="winrm", line=1, user="CORP\\admin", domain="OTHER")
        run_winrm(t, "pw", verify_tls=True, timeout=60, client_factory=FakeClient)
        c = FakeClient.instances[0]
        self.assertEqual(c.server, "[fd00::5]")
        self.assertEqual(c.kw["port"], 5985)
        self.assertFalse(c.kw["ssl"])
        self.assertEqual(c.kw["username"], "CORP\\admin")  # an explicit DOMAIN\\user wins

    def test_errors_without_output(self):
        class Err:
            error = ["Access is denied.\x1b[0m"]

        class Failing(FakeClient):
            def execute_ps(self, script):
                return "", Err(), True

        t = Target(host="h", method="winrm", line=1, user="u")
        with self.assertRaisesRegex(CollectError, "^PowerShell error: Access is denied.\\[0m$"):
            run_winrm(t, "pw", verify_tls=True, timeout=60, client_factory=Failing)

    def test_client_exception_becomes_collect_error(self):
        class Boom(FakeClient):
            def execute_ps(self, script):
                raise RuntimeError("401 Unauthorized")

        t = Target(host="h", method="winrm", line=1, user="u")
        with self.assertRaisesRegex(CollectError, "RuntimeError: 401 Unauthorized"):
            run_winrm(t, "pw", verify_tls=True, timeout=60, client_factory=Boom)

    def test_missing_extra(self):
        def factory(*a, **k):
            raise ImportError("No module named 'pypsrp'")

        with self.assertRaisesRegex(MissingExtra, "pypsrp"):
            run_winrm(Target(host="h", method="winrm", line=1), "pw", verify_tls=True, timeout=60, client_factory=None,
                      importer=factory)


class Scripts(unittest.TestCase):
    """The remote scripts are the app's collect commands, printing to stdout instead of a file."""

    def test_posix(self):
        for needle in ("### netstat-parser v1", "hostname: ", "collected: ", "addresses: ", "echo \"### netstat\"\n",
                       "ss -tunap", "netstat -tunapW", "netstat -anvW -p tcp", "netstat -anvW -p udp", "Darwin"):
            self.assertIn(needle, POSIX_SCRIPT)
        self.assertNotIn("_netstat.txt", POSIX_SCRIPT)

    def test_powershell(self):
        for needle in ("'### netstat-parser v1'", "hostname: $h", "netstat -ano", "'### netstat'"):
            self.assertIn(needle, POWERSHELL_SCRIPT)
        self.assertNotIn("Out-File", POWERSHELL_SCRIPT)


if __name__ == "__main__":
    unittest.main()
