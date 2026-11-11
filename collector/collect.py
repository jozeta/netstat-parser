#!/usr/bin/env python3
"""netstat-parser collector. Usage: python3 collector/collect.py targets.txt [--dry-run] [--out DIR]"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from npcollect.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
