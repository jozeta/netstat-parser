"""Targets file parser. The format is shared with the web app's "Collector targets" export.

One target per line: ``<host> <method> [key=value ...]``. ``#`` starts a comment (whole line, or
after whitespace). Methods: ssh, winrm. Keys: user, port, key, password-env, domain.
The file is untrusted operator input: values that could be read as command-line options are
rejected, because the host and key path end up in an ``ssh`` argument list.
"""

import re
from dataclasses import dataclass
from typing import List, Optional, Tuple

METHODS = ("ssh", "winrm")
KEYS = ("user", "port", "key", "password-env", "domain")
# Only NP_* variables: a targets file (untrusted) must not be able to send an arbitrary secret from
# the operator's environment, such as AWS_SECRET_ACCESS_KEY, as the password to a host it names.
_ENV_NAME = re.compile(r"^NP_[A-Za-z0-9_]+$")
_NAME = re.compile(r"[A-Za-z0-9._-]+")  # host name or IPv4 address
_IPV6 = re.compile(r"[0-9A-Fa-f:.]*:[0-9A-Fa-f:.]*(%[A-Za-z0-9._-]+)?")  # optional %zone (link-local)
_PORT = re.compile(r"[0-9]{1,5}")


@dataclass(frozen=True)
class Target:
    host: str
    method: str
    line: int
    user: Optional[str] = None
    port: Optional[int] = None
    key: Optional[str] = None
    password_env: Optional[str] = None
    domain: Optional[str] = None


@dataclass(frozen=True)
class TargetError:
    line: int
    message: str


def _strip_comment(raw: str) -> str:
    if raw.lstrip().startswith("#"):
        return ""
    return re.split(r"\s#", raw, maxsplit=1)[0]


def _check_host(host: str, method: str) -> Optional[str]:
    """None if the host is usable, else the error. Brackets are allowed only around a whole IPv6
    address (``[fe80::1]``); a port belongs in port=, not in the host."""
    invalid = f"'{host}' is not a valid host name or address"
    if host.startswith("-"):
        return invalid
    bracketed = re.fullmatch(r"\[([^\[\]]*)\](.*)", host)
    if bracketed:
        addr, rest = bracketed.groups()
        if rest:
            return (f"'{host}': put the port in port=, not in the host" if re.fullmatch(r":[0-9]+", rest)
                    else invalid)
        if not _IPV6.fullmatch(addr):
            return invalid
    elif "[" in host or "]" in host:
        return invalid
    elif host.count(":") == 1:
        return f"'{host}': put the port in port=, not in the host"
    elif not (_NAME.fullmatch(host) or _IPV6.fullmatch(host)):
        return invalid
    if "%" in host and method == "winrm":
        return f"'{host}': winrm does not support IPv6 zone ids (%...); use a global address or the host name"
    return None


def _parse_line(fields: List[str], line: int) -> Tuple[Optional[Target], Optional[str]]:
    host = fields[0]
    if len(fields) < 2:
        return None, "missing method (ssh or winrm)"
    method = fields[1].lower()
    if method == "smb":
        return None, "SMB is not supported; use winrm (WinRM must be enabled on the target)"
    if method not in METHODS:
        return None, f"unknown method '{fields[1]}' (use ssh or winrm)"
    host_error = _check_host(host, method)
    if host_error:
        return None, host_error
    values = {}
    for field in fields[2:]:
        name, sep, value = field.partition("=")
        name = name.lower()
        if not sep or not value:
            return None, f"'{field}' is not key=value"
        if name == "hash":
            return None, "hash= is not supported (no pass-the-hash); use password-env= or the prompt"
        if name not in KEYS:
            return None, f"unknown key '{name}' (use {', '.join(KEYS)})"
        if name in values:
            return None, f"'{name}' is given twice"
        if value.startswith("-"):
            return None, f"{name}= must not start with '-'"
        values[name] = value
    port = None
    if "port" in values:
        # ASCII digits only: str.isdigit() also accepts '²' and '٣', which int() rejects or misreads
        if not _PORT.fullmatch(values["port"]) or not 1 <= int(values["port"]) <= 65535:
            return None, f"port '{values['port']}' is not 1-65535"
        port = int(values["port"])
    env = values.get("password-env")
    if env is not None and method == "ssh":
        return None, "ssh takes no password (keys or ssh-agent only); remove password-env="
    if env is not None and not _ENV_NAME.match(env):
        return None, f"password-env '{env}' must be an environment variable whose name starts with NP_ (e.g. NP_CORP_PW)"
    if "domain" in values and method == "ssh":
        return None, "domain= only applies to winrm"
    return Target(host=host, method=method, line=line, user=values.get("user"), port=port,
                  key=values.get("key"), password_env=env, domain=values.get("domain")), None


def parse_targets(text: str) -> Tuple[List[Target], List[TargetError]]:
    """Parse a whole targets file. Returns the valid targets and one error per bad line."""
    targets: List[Target] = []
    errors: List[TargetError] = []
    for number, raw in enumerate(text.lstrip("﻿").splitlines(), start=1):
        fields = _strip_comment(raw).split()
        if not fields:
            continue
        target, error = _parse_line(fields, number)
        if error:
            errors.append(TargetError(number, error))
        else:
            targets.append(target)
    return targets, errors
