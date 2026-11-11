"""Regression tests for collector bugs 15, 29, 30, 31 and 32."""

import io
import os
import shutil
import subprocess
import tempfile
import threading
import unittest
from pathlib import Path

from npcollect.output import host_from_header
from npcollect.remote import CollectError, POSIX_SCRIPT, run_ssh
from npcollect.targets import Target, parse_targets
from tests.test_cli import Harness, _OPEN

T = Target(host="10.0.5.12", method="ssh", line=1)
HEADER = b"### netstat-parser v1\nhostname: web01\n### netstat\n"


class PipePopen:
    """A fake ssh on real OS pipes: writes lots of stderr first, then stdout. A reader that stops
    draining stderr makes the writer block, as a real ssh would."""

    def __init__(self, stderr_bytes):
        self.stderr_bytes = stderr_bytes
        self.killed = False

    def __call__(self, argv, **kw):
        out_r, out_w = os.pipe()
        err_r, err_w = os.pipe()
        self.stdout, self.stderr = os.fdopen(out_r, "rb", buffering=0), os.fdopen(err_r, "rb", buffering=0)
        self.stdin = io.BytesIO()

        def work():
            try:
                with os.fdopen(err_w, "wb") as e:
                    e.write(b"x" * self.stderr_bytes)
                with os.fdopen(out_w, "wb") as o:
                    o.write(HEADER)
            except OSError:
                pass

        self.worker = threading.Thread(target=work, daemon=True)
        self.worker.start()
        return self

    def wait(self, timeout=None):
        self.worker.join(timeout)
        if self.worker.is_alive():
            raise subprocess.TimeoutExpired("ssh", timeout)
        return 0

    def kill(self):
        self.killed = True
        for f in (self.stdout, self.stderr):
            try:
                f.close()
            except OSError:
                pass


class Bug15StderrDrain(unittest.TestCase):
    def test_lots_of_stderr_does_not_stall_stdout(self):
        fake = PipePopen(300 * 1024)
        try:
            self.assertEqual(run_ssh(T, accept_new=False, timeout=3, popen=fake), HEADER)
            self.assertFalse(fake.killed)
        finally:
            fake.stdout.close()
            fake.stderr.close()


class Bug29Port(unittest.TestCase):
    def test_non_ascii_digits_are_a_line_error(self):
        for port in ("²", "٣", "１２"):
            targets, errors = parse_targets(f"10.0.0.1 ssh port={port}\n")
            self.assertEqual(targets, [], port)
            self.assertEqual(len(errors), 1)
            self.assertIn("1-65535", errors[0].message)

    def test_ascii_ports_still_work(self):
        targets, errors = parse_targets("10.0.0.1 ssh port=22\n10.0.0.2 ssh port=0022\n")
        self.assertEqual(errors, [])
        self.assertEqual([t.port for t in targets], [22, 22])
        _, errors = parse_targets("10.0.0.1 ssh port=0\n10.0.0.1 ssh port=123456\n")
        self.assertEqual(len(errors), 2)

    def test_cli_dry_run_reports_the_line(self):
        h = Harness("10.0.0.1 ssh port=²\n")
        try:
            self.assertEqual(h.main("--dry-run"), 2)
            self.assertIn("line 1:", h.text())
        finally:
            while _OPEN:
                _OPEN.pop().cleanup()


class Bug30OsRelease(unittest.TestCase):
    def _os_line(self, shell):
        line = next(l for l in POSIX_SCRIPT.splitlines() if l.lstrip().startswith('echo "os: $('))
        with tempfile.TemporaryDirectory() as d:
            # /etc/os-release may exist here; point the line at a missing file to test the fallback
            script = line.replace("/etc/os-release", str(Path(d) / "missing")) + "\necho done\n"
            r = subprocess.run(shell + ["-c", script], capture_output=True, text=True, timeout=10)
        return r.stdout

    def test_fallback_when_os_release_is_missing(self):
        shells = [s for s in (["dash"], ["bash", "--posix"], ["sh"]) if shutil.which(s[0])]
        if not shells:
            self.skipTest("no POSIX shell")
        expected = subprocess.run(["uname", "-sr"], capture_output=True, text=True).stdout.strip()
        for shell in shells:
            out = self._os_line(shell)
            self.assertIn(f"os: {expected}\n", out, shell)
            self.assertIn("done", out, shell)

    def test_reads_pretty_name_when_present(self):
        line = next(l for l in POSIX_SCRIPT.splitlines() if l.lstrip().startswith('echo "os: $('))
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / "os-release"
            f.write_text('PRETTY_NAME="Test Linux 1"\n')
            script = line.replace("/etc/os-release", str(f))
            sh = "dash" if shutil.which("dash") else "sh"
            r = subprocess.run([sh, "-c", script], capture_output=True, text=True, timeout=10)
        self.assertEqual(r.stdout.strip(), "os: Test Linux 1")


class Bug31EmptyHostname(unittest.TestCase):
    def tearDown(self):
        while _OPEN:
            _OPEN.pop().cleanup()

    def test_header_without_hostname_is_not_no_header(self):
        self.assertEqual(host_from_header(b"### netstat-parser v1\nhostname: \n### netstat\n"), "")
        self.assertEqual(host_from_header(b"### netstat-parser v1\nos: x\n### netstat\n"), "")
        self.assertIsNone(host_from_header(b"Active Internet connections\n"))

    def test_empty_hostname_uses_the_target_name(self):
        h = Harness("10.0.0.1 ssh\n", ssh=lambda t: b"### netstat-parser v1\nhostname: \n### netstat\n")
        self.assertEqual(h.main(), 0)
        self.assertEqual(h.files(), ["10.0.0.1_netstat.txt"])


class Bug32Hosts(unittest.TestCase):
    def ok(self, line):
        targets, errors = parse_targets(line + "\n")
        self.assertEqual(errors, [], line)
        return targets[0]

    def bad(self, line, word):
        targets, errors = parse_targets(line + "\n")
        self.assertEqual(targets, [], line)
        self.assertIn(word, errors[0].message, line)

    def test_valid_hosts(self):
        for line in ("::1 ssh", "[::1] ssh", "fe80::1%eth0 ssh", "[fe80::1%en0] ssh", "dc01.corp.local winrm",
                     "2001:db8::5 winrm", "[2001:db8::5] winrm", "10.0.0.1 ssh"):
            self.ok(line)

    def test_port_in_host_is_rejected(self):
        self.bad("[::1]:22 ssh", "port=")
        self.bad("10.0.0.1:22 ssh", "port=")
        self.bad("host.example:5985 winrm", "port=")

    def test_stray_brackets_are_rejected(self):
        for host in ("[::1", "::1]", "[[::1]]", "a[b]c", "[]", "[10.0.0.1]"):
            self.bad(f"{host} ssh", "valid")

    def test_zone_id_rejected_for_winrm_only(self):
        self.bad("fe80::1%eth0 winrm", "zone")
        self.bad("[fe80::1%eth0] winrm", "zone")
        self.bad("host%x ssh", "valid")
        self.bad("fe80::1% ssh", "valid")
