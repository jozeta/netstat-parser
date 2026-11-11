import tempfile
import unittest
from pathlib import Path

from npcollect.output import clean_message, host_from_header, safe_name, write_output
from npcollect.redact import Redactor


class Output(unittest.TestCase):
    def test_host_from_header(self):
        data = b"### netstat-parser v1\r\nhostname: dc01.corp.local\r\nos: x\r\n### netstat\r\nhostname: later\r\n"
        self.assertEqual(host_from_header(data), "dc01.corp.local")
        self.assertIsNone(host_from_header(b"Active Connections\r\n  Proto ...\r\nhostname: nope\r\n"))
        # a header without a hostname is still a header: "" (the caller falls back to the target name)
        self.assertEqual(host_from_header(b"### netstat-parser v1\nos: x\n### netstat\n"), "")

    def test_safe_name(self):
        self.assertEqual(safe_name("dc01.corp.local"), "dc01.corp.local")
        self.assertEqual(safe_name("../../etc/passwd"), "etc_passwd")
        self.assertEqual(safe_name("WS 1\x1b[0m/\\:*"), "WS_1_0m")
        self.assertEqual(safe_name("fe80::1%en0"), "fe80_1_en0")
        self.assertIsNone(safe_name("..."))
        self.assertIsNone(safe_name(""))
        self.assertEqual(len(safe_name("a" * 300)), 100)

    def test_write_never_overwrites(self):
        with tempfile.TemporaryDirectory() as d:
            p1 = write_output(Path(d), "DC01", b"one")
            p2 = write_output(Path(d), "DC01", b"two")
            p3 = write_output(Path(d), "DC01", b"three")
            self.assertEqual([p.name for p in (p1, p2, p3)], ["DC01_netstat.txt", "DC01_2_netstat.txt", "DC01_3_netstat.txt"])
            self.assertEqual(p1.read_bytes(), b"one")

    def test_clean_message(self):
        self.assertEqual(clean_message("a\x1b[2J\x00b\r\n  c‮d"), "a[2Jb cd")
        self.assertEqual(clean_message("x" * 500, limit=10), "xxxxxxxxx…")


class Redaction(unittest.TestCase):
    def test_scrubs_every_secret_longest_first(self):
        r = Redactor()
        r.add("pass")
        r.add("password1")
        r.add("")
        self.assertEqual(r.scrub("bad password1 and pass"), "bad *** and ***")
        self.assertEqual(r.scrub("nothing here"), "nothing here")


if __name__ == "__main__":
    unittest.main()
