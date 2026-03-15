from __future__ import annotations

from conftest import load_jsonl
from onetool.vfs.path_utils import base_name, is_strict_descendant_path, parent_of, posix_normalize


def test_path_utils_match_golden_snapshots() -> None:
    for record in load_jsonl("vfs/path-utils.jsonl"):
        kind = record["kind"]
        if kind == "normalize":
            assert posix_normalize(record["input"]) == record["output"]
        elif kind == "parentOf":
            assert parent_of(record["input"]) == record["output"]
        elif kind == "baseName":
            assert base_name(record["input"]) == record["output"]
        else:
            assert is_strict_descendant_path(record["ancestor"], record["candidate"]) is record["output"]
