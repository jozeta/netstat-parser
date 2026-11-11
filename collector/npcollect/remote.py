"""Running the read-only collect script on a target over SSH (system ssh) or WinRM (pypsrp)."""

import importlib
import os
import subprocess
import threading
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


def _size(n: int) -> str:
    return f"{n // (1024 * 1024)} MB" if n >= 1024 * 1024 else f"{n} bytes"


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


def run_ssh(t: Target, *, accept_new: bool, timeout: float, popen=subprocess.Popen, max_bytes: int = MAX_BYTES) -> bytes:
    """Run the POSIX script over ssh. Output is read as it arrives and ssh is killed past max_bytes
    or after timeout seconds, so a hostile host can't fill the operator's memory."""
    argv = ssh_argv(t, accept_new=accept_new)
    try:
        proc = popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except FileNotFoundError:
        raise CollectError("ssh client not found on this machine (install OpenSSH)") from None
    out, err, too_big = bytearray(), bytearray(), threading.Event()

    def read_out():
        while True:
            chunk = proc.stdout.read(65536)
            if not chunk:
                return
            out.extend(chunk)
            if len(out) > max_bytes:
                too_big.set()
                proc.kill()
                return

    def read_err():
        # keep draining until EOF so a chatty ssh never blocks on a full pipe; keep only the first 64 kB
        while True:
            chunk = proc.stderr.read(65536)
            if not chunk:
                return
            if len(err) < 65536:
                err.extend(chunk[: 65536 - len(err)])

    readers = [threading.Thread(target=read_out, daemon=True), threading.Thread(target=read_err, daemon=True)]
    for r in readers:
        r.start()
    try:
        proc.stdin.write(POSIX_SCRIPT.encode())
        proc.stdin.close()
    except OSError:
        pass  # ssh exited early; its exit code and stderr say why
    try:
        code = proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        raise CollectError(f"timed out after {timeout:g} s") from None
    for r in readers:
        r.join(timeout=5)
    if too_big.is_set():
        raise CollectError(f"output is more than {_size(max_bytes)}; not saved; ssh was stopped")
    if code != 0:
        detail = clean_message(bytes(err).decode("utf-8", errors="replace")) or "no error text"
        raise CollectError(f"ssh exit {code}: {detail}")
    return bytes(out)


def _pypsrp_client():
    return importlib.import_module("pypsrp.client").Client


def run_winrm(t: Target, password: str, *, verify_tls: bool, timeout: float, client_factory=None,
              importer=_pypsrp_client, max_bytes: int = MAX_BYTES) -> bytes:
    """Run the PowerShell script over WinRM. pypsrp's own timeouts are per socket read, so the whole
    call also runs under an overall time limit. Error text is returned raw: the caller scrubs
    secrets first and cleans afterwards. pypsrp buffers the whole output, so the size cap is
    checked after it arrives (documented)."""
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
    result = {}

    def call():
        try:
            client = client_factory(server, username=user, password=password, port=port, ssl=port == 5986,
                                    cert_validation=verify_tls, auth="negotiate",
                                    connection_timeout=timeout, read_timeout=timeout)
            result["value"] = client.execute_ps(POWERSHELL_SCRIPT)
        except Exception as e:  # pypsrp raises many types; all mean "this target failed"
            result["error"] = f"{type(e).__name__}: {e}"

    worker = threading.Thread(target=call, daemon=True)
    worker.start()
    worker.join(timeout)
    if worker.is_alive():
        raise CollectError(f"timed out after {timeout:g} s")
    if "error" in result:
        raise CollectError(result["error"])
    output, streams, had_errors = result["value"]
    if had_errors and not output:
        errors = "; ".join(str(x) for x in getattr(streams, "error", [])) or "unknown error"
        raise CollectError(f"PowerShell error: {errors}")
    data = output.encode("utf-8")
    if len(data) > max_bytes:
        raise CollectError(f"output is more than {_size(max_bytes)}; not saved")
    return data
