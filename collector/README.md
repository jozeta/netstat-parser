# netstat-parser collector

Collects `<hostname>_netstat.txt` files from many machines at once, over **SSH** or **WinRM**, and
saves them on your machine for the web app. It runs only the read-only commands from the app's
*How to collect* page and changes nothing on the targets, apart from the logins and logs a
remote session always leaves behind.

Python 3.9 or newer. SSH needs nothing extra (it uses your system `ssh`). WinRM needs `pypsrp`:

```sh
python3 -m pip install pypsrp
```

Without it, WinRM targets are skipped with a message and SSH targets still run.

## Use

```sh
python3 collector/collect.py targets.txt --dry-run     # show the plan, contact nothing
python3 collector/collect.py targets.txt --out netstat-files
```

Then load the files from `netstat-files/` in the web app.

| Option | Meaning |
|---|---|
| `--out DIR` | output folder (default `./netstat-files`); existing files are never overwritten (`_2`, `_3`, …) |
| `--workers N` | targets collected at the same time (default 8) |
| `--timeout S` | seconds per target (default 120) |
| `--dry-run` | print each target's method, port, user, where the password comes from and the ssh command |
| `--accept-new-hostkeys` | SSH: trust host keys seen for the first time (default: unknown keys fail) |
| `--no-verify-tls` | WinRM on 5986: accept self-signed certificates |

Exit code: 0 when every target was collected, 1 when any failed, 2 when nothing ran (bad targets
file, missing environment variable).

## Targets file

Export **Collector targets** from the graph for a starting list, or write one by hand (see
[targets.example.txt](targets.example.txt)). One target per line, `#` comments:

```
<host> <ssh|winrm> [user=NAME] [port=N] [key=PATH] [password-env=NP_VAR] [domain=NAME]
```

- **ssh**: keys or ssh-agent only (`BatchMode`, no password prompts). `key=` selects a private key.
  Your `~/.ssh/config` applies as usual.
- **winrm**: port 5985 (HTTP, NTLM/Kerberos message encryption) by default, 5986 for HTTPS.
  `domain=CORP` with `user=admin` logs in as `CORP\admin`. The password comes from the
  environment variable named by `password-env=` (it must start with `NP_`, e.g. `NP_CORP_PW`, so a
  targets file can't send any other secret from your environment), or is asked once per user
  before the run starts.

Review a targets file you didn't write before running it. A bad line stops the run before anything is contacted, with every problem listed by line number.
SMB and pass-the-hash are deliberately not supported.

## Security notes

- Passwords are never written to disk and are scrubbed from every message the collector prints.
  Targets files hold host lists and user names: they are client data, so keep them out of git
  (`targets*.txt` is gitignored here).
- Remote output is treated as untrusted: capped at 50 MB (ssh is stopped as soon as it passes the
  cap; WinRM output is buffered by pypsrp, so its cap applies after it arrives), saved as bytes,
  never echoed to the terminal. Output without the netstat-parser header counts as a failure.
  `--timeout` is an overall limit per target for both methods. Remote error text has control characters removed before it is shown. File names come
  from the returned hostname, reduced to letters, digits, `.`, `_` and `-`.
- Host names and key paths that start with `-` are rejected, and `ssh` gets the host after `--`,
  so a targets file can't inject ssh options.

## Tests

```sh
npm run test:collector    # or: python3 -m unittest discover -s collector/tests -t collector
```

Remote execution is mocked. Real-machine status (2026-11-12): full SSH collections ran against
Linux containers (Debian 12 with `ss` and `ip`, Debian 12 with only net-tools, Alpine 3.20 with
busybox and no `ip`), with the collector on macOS and on Python 3.9. Unknown host keys are refused
without `--accept-new-hostkeys`. The POSIX script also ran locally on macOS. Not yet verified on
real targets: SSH to a macOS machine, and the WinRM path with the Windows script.
