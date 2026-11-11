import io
import tempfile
import unittest
from pathlib import Path

from npcollect.cli import main
from npcollect.remote import CollectError

HEADER = b"### netstat-parser v1\nhostname: %s\n### netstat\n"
_OPEN = []


class Harness:
    def __init__(self, targets_text, env=None, has_winrm=True, ssh=None, winrm=None, prompts=None):
        self.dir = tempfile.TemporaryDirectory()
        _OPEN.append(self.dir)
        self.root = Path(self.dir.name)
        (self.root / "targets.txt").write_text(targets_text, encoding="utf-8")
        self.env = env or {}
        self.has_winrm = has_winrm
        self.ssh_calls, self.winrm_calls, self.prompted = [], [], []
        self._ssh, self._winrm = ssh, winrm
        self._prompts = list(prompts or [])
        self.out, self.err = io.StringIO(), io.StringIO()

    def prompt(self, text):
        self.prompted.append(text)
        return self._prompts.pop(0)

    def run_ssh(self, t, **kw):
        self.ssh_calls.append(t.host)
        return self._ssh(t) if self._ssh else HEADER % t.host.encode()

    def run_winrm(self, t, password, **kw):
        self.winrm_calls.append((t.host, password, kw))
        return self._winrm(t, password) if self._winrm else HEADER % (b"WIN-" + t.host.encode())

    def main(self, *args):
        argv = [str(self.root / "targets.txt"), "--out", str(self.root / "out"), *args]
        self.code = main(argv, env=self.env, prompt=self.prompt, out=self.out, err=self.err,
                         run_ssh=self.run_ssh, run_winrm=self.run_winrm, has_winrm=lambda: self.has_winrm)
        return self.code

    def files(self):
        d = self.root / "out"
        return sorted(p.name for p in d.iterdir()) if d.exists() else []

    def text(self):
        return self.out.getvalue() + self.err.getvalue()


class Cli(unittest.TestCase):
    def tearDown(self):
        while _OPEN:
            _OPEN.pop().cleanup()

    def test_collects_and_names_files_from_header(self):
        h = Harness("10.0.0.1 ssh user=root\n10.0.0.2 ssh\n")
        self.assertEqual(h.main(), 0)
        self.assertEqual(h.files(), ["10.0.0.1_netstat.txt", "10.0.0.2_netstat.txt"])
        self.assertIn("2 collected, 0 failed", h.text())

    def test_output_without_header_is_a_failure(self):
        for body in (b"", b"Active Internet connections\n"):
            h = Harness("10.0.0.1 ssh\n", ssh=lambda t, body=body: body)
            self.assertEqual(h.main(), 1)
            self.assertEqual(h.files(), [])
            self.assertIn("header", h.text())

    def test_unsafe_hostname_falls_back_to_target_name(self):
        h = Harness("fe80::1 ssh\n", ssh=lambda t: b"### netstat-parser v1\nhostname: ...\n### netstat\n")
        h.main()
        self.assertEqual(h.files(), ["fe80_1_netstat.txt"])

    def test_secret_is_scrubbed_before_cleaning_and_truncation(self):
        secret = "Hunter 2\twith  spaces"

        def winrm(t, password):
            raise CollectError("x" * 290 + " login failed: " + password)

        h = Harness("DC01 winrm user=admin password-env=NP_PW\n", env={"NP_PW": secret}, winrm=winrm)
        h.main()
        for part in ("Hunter", "spaces", "with"):
            self.assertNotIn(part, h.text())

    def test_one_failure_does_not_stop_the_run(self):
        def ssh(t):
            if t.host == "bad":
                raise CollectError("ssh exit 255: Permission denied")
            return HEADER % b"good"

        h = Harness("bad ssh\ngood ssh\n", ssh=ssh)
        self.assertEqual(h.main(), 1)
        self.assertEqual(h.files(), ["good_netstat.txt"])
        self.assertIn("bad", h.text())
        self.assertIn("Permission denied", h.text())
        self.assertIn("1 collected, 1 failed", h.text())

    def test_invalid_lines_abort_before_connecting(self):
        h = Harness("10.0.0.1 ssh\n10.0.0.2 smb user=admin\n10.0.0.3 winrm hash=aa:bb\n")
        self.assertEqual(h.main(), 2)
        self.assertEqual(h.ssh_calls, [])
        self.assertIn("line 2", h.text())
        self.assertIn("line 3", h.text())
        self.assertEqual(h.files(), [])

    def test_password_from_env_is_used_and_scrubbed(self):
        def winrm(t, password):
            raise CollectError(f"login failed for password {password}")

        h = Harness("DC01 winrm user=admin password-env=NP_PW\n", env={"NP_PW": "Hunter2!"}, winrm=winrm)
        self.assertEqual(h.main(), 1)
        self.assertEqual(h.winrm_calls[0][1], "Hunter2!")
        self.assertNotIn("Hunter2!", h.text())
        self.assertIn("***", h.text())
        self.assertEqual(h.prompted, [])

    def test_missing_env_var_aborts(self):
        h = Harness("DC01 winrm user=admin password-env=NP_PW\n")
        self.assertEqual(h.main(), 2)
        self.assertIn("NP_PW", h.text())
        self.assertEqual(h.winrm_calls, [])

    def test_prompt_once_per_user_before_the_run(self):
        h = Harness("A winrm user=admin domain=CORP\nB winrm user=CORP\\admin\nC winrm user=other\n",
                    prompts=["p1", "p2"])
        self.assertEqual(h.main(), 0)
        self.assertEqual(len(h.prompted), 2)
        self.assertIn("CORP\\admin", h.prompted[0])
        self.assertEqual(sorted((c[0], c[1]) for c in h.winrm_calls), [("A", "p1"), ("B", "p1"), ("C", "p2")])
        self.assertNotIn("p1", h.text())

    def test_without_pypsrp_winrm_targets_are_skipped(self):
        h = Harness("A winrm user=admin\nB ssh\n", has_winrm=False)
        self.assertEqual(h.main(), 1)
        self.assertEqual(h.prompted, [])
        self.assertEqual(h.winrm_calls, [])
        self.assertEqual(h.ssh_calls, ["B"])
        self.assertIn("pypsrp", h.text())

    def test_dry_run_connects_to_nothing(self):
        h = Harness("10.0.0.1 ssh user=root key=~/.ssh/id\nDC01 winrm user=admin password-env=NP_PW\nDC02 winrm user=x\n",
                    env={"NP_PW": "Hunter2!"})
        self.assertEqual(h.main("--dry-run"), 0)
        self.assertEqual((h.ssh_calls, h.winrm_calls, h.prompted), ([], [], []))
        self.assertEqual(h.files(), [])
        t = h.text()
        self.assertIn("ssh -T", t)
        self.assertIn("$NP_PW", t)
        self.assertIn("prompt", t)
        self.assertNotIn("Hunter2!", t)

    def test_options_reach_the_runners(self):
        h = Harness("A winrm user=u password-env=NP_PW\n", env={"NP_PW": "x"})
        h.main("--no-verify-tls", "--timeout", "15")
        kw = h.winrm_calls[0][2]
        self.assertEqual((kw["verify_tls"], kw["timeout"]), (False, 15))

    def test_missing_targets_file(self):
        code = main(["/nonexistent/targets.txt"], env={}, prompt=None, out=io.StringIO(), err=io.StringIO(),
                    run_ssh=None, run_winrm=None, has_winrm=lambda: True)
        self.assertEqual(code, 2)


if __name__ == "__main__":
    unittest.main()
