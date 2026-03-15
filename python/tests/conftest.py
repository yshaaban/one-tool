from __future__ import annotations

import base64
import json
from pathlib import Path
import sys
from typing import Any

import pytest

ROOT_DIR = Path(__file__).resolve().parents[2]
SNAPSHOT_ROOT = ROOT_DIR / "snapshots"
SRC_ROOT = ROOT_DIR / "python" / "src"

if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))


def load_json(relative_path: str) -> Any:
    return json.loads((SNAPSHOT_ROOT / relative_path).read_text(encoding="utf-8"))


def load_jsonl(relative_path: str) -> list[Any]:
    path = SNAPSHOT_ROOT / relative_path
    records: list[Any] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.strip() == "":
            continue
        records.append(json.loads(line))
    return records


def decode_b64(value: str) -> bytes:
    if value == "":
        return b""
    return base64.b64decode(value.encode("ascii"))


@pytest.fixture(scope="session")
def snapshot_root() -> Path:
    return SNAPSHOT_ROOT
