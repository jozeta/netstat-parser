import unittest

from npcollect.targets import parse_targets


class ParseTargets(unittest.TestCase):
    def test_ssh_and_winrm_lines(self):
        text = (
            "# header comment\n"
            "\n"
            "10.0.5.12 ssh user=root key=~/.ssh/id_ed25519\n"
            "DC01   winrm user=admin domain=CORP password-env=NP_CORP_PW port=5986  # the DC\n"
        )
        targets, errors = parse_targets(text)
        self.assertEqual(errors, [])
        self.assertEqual(len(targets), 2)
        a, b = targets
        self.assertEqual((a.host, a.method, a.user, a.key, a.port, a.line), ("10.0.5.12", "ssh", "root", "~/.ssh/id_ed25519", None, 3))
        self.assertEqual((b.host, b.method, b.user, b.domain, b.password_env, b.port), ("DC01", "winrm", "admin", "CORP", "NP_CORP_PW", 5986))

    def test_app_export_lines_parse(self):
        targets, errors = parse_targets("10.10.10.97 ssh user=CHANGEME  # method unknown\n")
        self.assertEqual(errors, [])
        self.assertEqual(targets[0].user, "CHANGEME")

    def test_bom_and_crlf(self):
        targets, errors = parse_targets("﻿10.0.0.1 ssh\r\n10.0.0.2 ssh\r\n")
        self.assertEqual(errors, [])
        self.assertEqual([t.host for t in targets], ["10.0.0.1", "10.0.0.2"])

    def test_every_bad_line_is_reported_with_its_number(self):
        text = (
            "10.0.0.1 ssh\n"
            "10.0.0.2\n"                       # 2: no method
            "10.0.0.3 smb user=admin\n"        # 3: smb dropped
            "10.0.0.4 ssh colour=blue\n"       # 4: unknown key
            "10.0.0.5 winrm hash=aa:bb\n"      # 5: hashes not supported
            "10.0.0.6 ssh port=70000\n"        # 6: bad port
            "10.0.0.7 ssh user\n"              # 7: not key=value
            "10.0.0.8 ssh password-env=NP_PW\n"   # 8: ssh takes no passwords
            "10.0.0.9 ssh user=a user=b\n"     # 9: duplicate key
            "-oProxyCommand=x ssh\n"           # 10: host looks like an option
            "10.0.0.11 ssh key=-oX\n"          # 11: key path looks like an option
            "10.0.0.12 winrm password-env=1X\n"  # 12: not a valid env var name
        )
        targets, errors = parse_targets(text)
        self.assertEqual([t.host for t in targets], ["10.0.0.1"])
        self.assertEqual([e.line for e in errors], list(range(2, 13)))
        msgs = {e.line: e.message for e in errors}
        self.assertIn("method", msgs[2])
        self.assertIn("SMB", msgs[3])
        self.assertIn("hash", msgs[5])
        self.assertIn("password", msgs[8])

    def test_user_with_backslash_domain(self):
        targets, errors = parse_targets("DC01 winrm user=CORP\\admin\n")
        self.assertEqual(errors, [])
        self.assertEqual(targets[0].user, "CORP\\admin")

    def test_password_env_must_use_the_np_prefix(self):
        # a hostile targets file must not be able to send e.g. AWS_SECRET_ACCESS_KEY to its own host
        targets, errors = parse_targets("h winrm user=u password-env=AWS_SECRET_ACCESS_KEY\n")
        self.assertEqual(targets, [])
        self.assertIn("NP_", errors[0].message)


if __name__ == "__main__":
    unittest.main()
