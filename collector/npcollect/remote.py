"""Running the read-only collect script on a target over SSH (system ssh) or WinRM (pypsrp)."""

import importlib
import os
import subprocess
from pathlib import Path

from .output import clean_message
from .targets import Target

_HERE = Path(__file__).resolve().parent
POSIX_SCRIPT = (_HERE / "collect.sh").read_text(encoding="utf-8")
POWERSHELL_SCRIPT = (_HERE / "collect.ps1").read_text(encoding="utf-8")
MAX_BYTES = 50 * 1024 * 1024  # same limit as the web app


class CollectError(Exception):
    """A target failed; the message is safe to show (cleaned, not yet secret-scrubbed)."""


class MissingExtra(CollectError):
    """An optional dependency is not installed."""


def _bare(host: str) -> str:
    return host[1:-1] if host.startswith("[") and host.endswith("]") else host


def ssh_argv(t: Target, *, accept_new: bool, connect_timeout: int = 10) -> list:
    argv = ["ssh", "-T", "-o", "BatchMode=yes", "-o", f"ConnectTimeout={connect_timeout}"]
    if accept_new:
        argv += ["-o", "StrictHostKeyChecking=accept-new"]
    if t.port:
        argv += ["-p", str(t.port)]
    if t.key:
        argv += ["-i", os.path.expanduser(t.key), "-o", "IdentitiesOnly=yes"]
    if t.user:
        argv += ["-l", t.user]
    return argv + ["--", _bare(t.host), "sh", "-s"]


def run_ssh(t: Target, *, accept_new: bool, timeout: int, run=subprocess.run, max_bytes: int = MAX_BYTES) -> bytes:
    argv = ssh_argv(t, accept_new=accept_new)
    try:
        done = run(argv, input=POSIX_SCRIPT.encode(), capture_output=True, timeout=timeout)
    except FileNotFoundError:
        raise CollectError("ssh client not found on this machine (install OpenSSH)") from None
    except subprocess.TimeoutExpired:
        raise CollectError(f"timed out after {timeout} s") from None
    if done.returncode != 0:
        detail = clean_message(done.stderr.decode("utf-8", errors="replace")) or "no error text"
        raise CollectError(f"ssh exit {done.returncode}: {detail}")
    if len(done.stdout) > max_bytes:
        raise CollectError(f"output is more than {max_bytes // (1024 * 1024)} MB; not saved")
    return done.stdout


def _pypsrp_client():
    return importlib.import_module("pypsrp.client").Client


def run_winrm(t: Target, password: str, *, verify_tls: bool, timeout: int, client_factory=None,
              importer=_pypsrp_client, max_bytes: int = MAX_BYTES) -> bytes:
    if client_factory is None:
        try:
            client_factory = importer()
        except ImportError:
            raise MissingExtra("WinRM needs the pypsrp package: python3 -m pip install pypsrp") from None
    host = _bare(t.host)
    server = f"[{host}]" if ":" in host else host
    user = t.user or ""
    if t.domain and "\\" not in user and "@" not in user:
        user = f"{t.domain}\\{user}"
    port = t.port or 5985
    try:
        client = client_factory(server, username=user, password=password, port=port, ssl=port == 5986,
                                cert_validation=verify_tls, auth="negotiate",
                                connection_timeout=timeout, read_timeout=timeout)
        output, streams, had_errors = client.execute_ps(POWERSHELL_SCRIPT)
    except Exception as e:  # pypsrp raises many types; all mean "this target failed"
        raise CollectError(clean_message(f"{type(e).__name__}: {e}")) from None
    if had_errors and not output:
        errors = "; ".join(str(x) for x in getattr(streams, "error", [])) or "unknown error"
        raise CollectError(clean_message(f"PowerShell error: {errors}"))
    data = output.encode("utf-8")
    if len(data) > max_bytes:
        raise CollectError(f"output is more than {max_bytes // (1024 * 1024)} MB; not saved")
    return data
