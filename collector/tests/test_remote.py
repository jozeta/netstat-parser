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


class FakePopen:
    """Stands in for subprocess.Popen: stdout/stderr are byte streams, kill() is recorded."""

    def __init__(self, stdout=b"", stderr=b"", returncode=0, hang=False, chunks=None):
        self.out, self.err, self.rc, self.hang = stdout, stderr, returncode, hang
        self.killed, self.stdin_data, self.argv, self.kw = False, None, None, None
        self.chunks = chunks

    def __call__(self, argv, **kw):
        import io
        self.argv, self.kw = argv, kw
        outer = self

        class In(io.BytesIO):
            def close(self):
                outer.stdin_data = self.getvalue()
                super().close()

        class Endless(io.RawIOBase):
            def readable(self):
                return True

            def readinto(self, b):
                if outer.killed:
                    return 0
                n = len(b)
                b[:n] = b"y" * n
                return n

        self.stdin = In()
        self.stdout = Endless() if self.chunks == "endless" else io.BytesIO(self.out)
        self.stderr = io.BytesIO(self.err)
        self.returncode = None
        return self

    def wait(self, timeout=None):
        import subprocess as sp
        if self.hang and not self.killed:
            raise sp.TimeoutExpired(self.argv, timeout)
        self.returncode = -9 if self.killed else self.rc
        return self.returncode

    def kill(self):
        self.killed = True


class RunSsh(unittest.TestCase):
    def test_feeds_script_on_stdin_and_returns_stdout(self):
        fake = FakePopen(stdout=b"### netstat-parser v1\n")
        out = run_ssh(T, accept_new=False, timeout=30, popen=fake)
        self.assertEqual(out, b"### netstat-parser v1\n")
        self.assertEqual(fake.stdin_data, POSIX_SCRIPT.encode())
        self.assertEqual(fake.argv, ssh_argv(T, accept_new=False))
        self.assertNotIn("shell", fake.kw)

    def test_failure_message_is_cleaned(self):
        fake = FakePopen(stderr=b"\x1b[31mPermission denied\x07 (publickey).\r\n", returncode=255)
        with self.assertRaises(CollectError) as cm:
            run_ssh(T, accept_new=False, timeout=30, popen=fake)
        self.assertEqual(str(cm.exception), "ssh exit 255: [31mPermission denied (publickey).")

    def test_timeout_kills_ssh(self):
        fake = FakePopen(hang=True)
        with self.assertRaisesRegex(CollectError, "timed out after 30 s"):
            run_ssh(T, accept_new=False, timeout=30, popen=fake)
        self.assertTrue(fake.killed)

    def test_endless_output_is_cut_off_at_the_cap(self):
        fake = FakePopen(chunks="endless")
        with self.assertRaisesRegex(CollectError, "more than"):
            run_ssh(T, accept_new=False, timeout=30, popen=fake, max_bytes=100_000)
        self.assertTrue(fake.killed)

    def test_missing_ssh_binary(self):
        def popen(argv, **kw):
            raise FileNotFoundError("ssh")

        with self.assertRaisesRegex(CollectError, "ssh client not found"):
            run_ssh(T, accept_new=False, timeout=30, popen=popen)


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
        with self.assertRaisesRegex(CollectError, "^PowerShell error: Access is denied.\x1b\\[0m$"):
            run_winrm(t, "pw", verify_tls=True, timeout=60, client_factory=Failing)

    def test_client_exception_becomes_collect_error(self):
        class Boom(FakeClient):
            def execute_ps(self, script):
                raise RuntimeError("401 Unauthorized")

        t = Target(host="h", method="winrm", line=1, user="u")
        with self.assertRaisesRegex(CollectError, "RuntimeError: 401 Unauthorized"):
            run_winrm(t, "pw", verify_tls=True, timeout=60, client_factory=Boom)

    def test_overall_timeout(self):
        import time

        class Slow(FakeClient):
            def execute_ps(self, script):
                time.sleep(2)
                return "late", None, False

        t = Target(host="h", method="winrm", line=1, user="u")
        start = time.monotonic()
        with self.assertRaisesRegex(CollectError, "timed out after 0.2 s"):
            run_winrm(t, "pw", verify_tls=True, timeout=0.2, client_factory=Slow)
        self.assertLess(time.monotonic() - start, 1.5)

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
