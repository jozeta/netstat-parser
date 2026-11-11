"""Command line: read a targets file, collect netstat files over SSH / WinRM, print a summary."""

import argparse
import getpass
import importlib.util
import os
import shlex
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from functools import partial
from pathlib import Path

from . import remote
from .output import clean_message, host_from_header, safe_name, write_output
from .redact import Redactor
from .targets import parse_targets


def _parser():
    p = argparse.ArgumentParser(
        prog="collect.py",
        description="Collect <hostname>_netstat.txt files from the targets listed in a targets file "
                    "(the web app's 'Collector targets' export). Runs read-only commands only.")
    p.add_argument("targets", help="targets file: <host> <ssh|winrm> [user= port= key= password-env= domain=]")
    p.add_argument("--out", default="netstat-files", help="output folder (default: ./netstat-files)")
    p.add_argument("--workers", type=int, default=8, help="targets collected at the same time (default 8)")
    p.add_argument("--timeout", type=int, default=120, help="seconds per target (default 120)")
    p.add_argument("--dry-run", action="store_true", help="print the plan and connect to nothing")
    p.add_argument("--accept-new-hostkeys", action="store_true",
                   help="ssh: trust and remember host keys seen for the first time (default: refuse)")
    p.add_argument("--no-verify-tls", action="store_true",
                   help="winrm over HTTPS (5986): accept self-signed certificates")
    return p


def _winrm_user(t):
    user = t.user or ""
    return f"{t.domain}\\{user}" if t.domain and "\\" not in user and "@" not in user else user


def _has_pypsrp():
    return importlib.util.find_spec("pypsrp") is not None


def main(argv=None, *, env=os.environ, prompt=getpass.getpass, out=sys.stdout, err=sys.stderr,
         run_ssh=remote.run_ssh, run_winrm=remote.run_winrm, has_winrm=_has_pypsrp) -> int:
    args = _parser().parse_args(argv)
    if args.workers < 1 or args.timeout < 1:
        print("--workers and --timeout must be at least 1", file=err)
        return 2
    try:
        text = Path(args.targets).read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        print(f"cannot read the targets file: {clean_message(str(e))}", file=err)
        return 2
    targets, errors = parse_targets(text)
    for e in errors:
        print(f"{args.targets} line {e.line}: {e.message}", file=err)
    if errors:
        print("Fix these lines first; nothing was collected.", file=err)
        return 2
    if not targets:
        print("The targets file lists no targets.", file=err)
        return 2

    winrm_ok = has_winrm()
    redactor = Redactor()
    passwords = {}  # WinRM user -> password; filled before any connection is made
    for t in targets:
        if t.method != "winrm" or not t.password_env:
            continue
        if t.password_env not in env:
            print(f"line {t.line}: environment variable {t.password_env} is not set; nothing was collected.", file=err)
            return 2

    if args.dry_run:
        for t in targets:
            if t.method == "ssh":
                cmd = " ".join(shlex.quote(a) for a in remote.ssh_argv(t, accept_new=args.accept_new_hostkeys))
                print(f"{t.host}: ssh  {cmd}  < collect.sh", file=out)
            else:
                port = t.port or 5985
                source = f"${t.password_env}" if t.password_env else "prompt"
                extra = "" if winrm_ok else "  (skipped: pypsrp not installed)"
                print(f"{t.host}: winrm port {port} ({'HTTPS' if port == 5986 else 'HTTP, encrypted'}) "
                      f"user {_winrm_user(t) or '(none)'}, password from {source}{extra}", file=out)
        print(f"Dry run: {len(targets)} targets, nothing was contacted. Output would go to {args.out}/", file=out)
        return 0

    if winrm_ok:
        for t in targets:
            if t.method != "winrm":
                continue
            user = _winrm_user(t)
            if t.password_env:
                passwords.setdefault(("env", t.password_env), env[t.password_env])
            elif ("user", user) not in passwords:
                passwords[("user", user)] = prompt(f"WinRM password for {user or '(no user)'}: ")
        for secret in passwords.values():
            redactor.add(secret)

    folder = Path(args.out)
    folder.mkdir(parents=True, exist_ok=True)

    def collect(t):
        if t.method == "ssh":
            data = run_ssh(t, accept_new=args.accept_new_hostkeys, timeout=args.timeout)
        else:
            if not winrm_ok:
                raise remote.MissingExtra("skipped: WinRM needs the pypsrp package: python3 -m pip install pypsrp")
            key = ("env", t.password_env) if t.password_env else ("user", _winrm_user(t))
            data = run_winrm(t, passwords[key], verify_tls=not args.no_verify_tls, timeout=args.timeout)
        claimed = host_from_header(data)
        if claimed is None:
            raise remote.CollectError("no netstat-parser header in the output (is the remote shell POSIX sh / PowerShell?)")
        base = safe_name(claimed) or safe_name(t.host) or f"target-line-{t.line}"
        return write_output(folder, base, data)

    ok = failed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(collect, t): t for t in targets}
        for future in as_completed(futures):
            t = futures[future]
            try:
                path = future.result()
            except Exception as e:  # one target's failure never stops the run
                failed += 1
                reason = str(e) if isinstance(e, remote.CollectError) else f"{type(e).__name__}: {e}"
                # scrub first: cleaning and truncating could split a secret so it no longer matches
                print(f"FAIL {t.host} ({t.method}): {clean_message(redactor.scrub(reason))}", file=err)
            else:
                ok += 1
                print(f"ok   {t.host} ({t.method}) -> {path}", file=out)
    print(f"{ok} collected, {failed} failed. Files are in {folder}/", file=out)
    return 0 if failed == 0 else 1
