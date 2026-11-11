"""Output naming and message cleaning. Remote output and error text are untrusted."""

import re
import unicodedata
from pathlib import Path
from typing import Optional

_UNSAFE = re.compile(r"[^A-Za-z0-9._-]+")


def host_from_header(data: bytes) -> Optional[str]:
    """The ``hostname:`` value of a netstat-parser header, or None if there is no header."""
    lines = data[:8192].decode("utf-8", errors="replace").lstrip("﻿").splitlines()
    if not lines or lines[0].strip() != "### netstat-parser v1":
        return None
    for line in lines[1:]:
        if line.startswith("### "):
            break
        name, sep, value = line.partition(":")
        if sep and name.strip().lower() == "hostname" and value.strip():
            return value.strip()
    return None


def safe_name(name: str) -> Optional[str]:
    """A file-name-safe form of a host name: letters, digits, '.', '_', '-' only; None if nothing is left."""
    cleaned = _UNSAFE.sub("_", clean_message(name, limit=1000)).strip("._")
    return cleaned[:100] or None


def write_output(folder: Path, base: str, data: bytes) -> Path:
    """Write ``<base>_netstat.txt``; never overwrite: ``<base>_2_netstat.txt`` and so on."""
    n = 1
    while True:
        path = folder / (f"{base}_netstat.txt" if n == 1 else f"{base}_{n}_netstat.txt")
        try:
            with open(path, "xb") as f:  # "x" claims the name atomically, also across worker threads
                f.write(data)
            return path
        except FileExistsError:
            n += 1


def clean_message(text: str, limit: int = 300) -> str:
    """Drop control and format characters (escape sequences, bidi), collapse whitespace, truncate."""
    kept = "".join(" " if ch in "\r\n\t" else ch for ch in text
                   if ch in "\r\n\t" or unicodedata.category(ch) not in ("Cc", "Cf"))
    kept = " ".join(kept.split())
    return kept if len(kept) <= limit else kept[: limit - 1] + "…"
