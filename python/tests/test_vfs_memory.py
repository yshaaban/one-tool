from __future__ import annotations

import asyncio
import base64
from collections.abc import Callable

from conftest import load_jsonl
from onetool.vfs.errors import VfsError
from onetool.vfs.memory_vfs import MemoryVFS
from onetool.vfs.policy import VfsResourcePolicy


def test_memory_vfs_matches_golden_snapshots() -> None:
    for record in load_jsonl("vfs/memory-vfs.jsonl"):
        asyncio.run(_assert_memory_vfs_case(record, _mock_now_ms()))


async def _assert_memory_vfs_case(
    record: dict[str, object],
    now_ms: Callable[[], int],
) -> None:
    vfs = MemoryVFS(
        resource_policy=_policy_from_snapshot(record.get("resourcePolicy")),
        _now_ms=now_ms,
    )

    for step in record["steps"]:
        step_record = step
        result = None
        caught_error: VfsError | None = None

        try:
            result = await _run_memory_vfs_step(vfs, step_record)
        except VfsError as caught:
            caught_error = caught

        if "error" in step_record:
            assert caught_error is not None
            error = step_record["error"]
            assert caught_error.code == error["code"]
            assert caught_error.path == error["path"]
            assert getattr(caught_error, "target_path", None) == error.get("targetPath")
            assert caught_error.details == error.get("details")
            assert str(caught_error) == error["message"]
            continue

        assert caught_error is None
        assert _normalize_result(result) == step_record["result"]


async def _run_memory_vfs_step(vfs: MemoryVFS, step: dict[str, object]) -> object:
    op = step["op"]
    if op == "writeBytes":
        return await vfs.write_bytes(step["path"], _decode_b64(step["data_b64"]), step.get("parents", True))
    if op == "appendBytes":
        return await vfs.append_bytes(step["path"], _decode_b64(step["data_b64"]), step.get("parents", True))
    if op == "mkdir":
        return await vfs.mkdir(step["path"], step.get("parents", True))
    if op == "listdir":
        return await vfs.listdir(step.get("path", "/"))
    if op == "readBytes":
        return await vfs.read_bytes(step["path"])
    if op == "readText":
        return await vfs.read_text(step["path"])
    if op == "delete":
        return await vfs.delete(step["path"])
    if op == "copy":
        src, dst = await vfs.copy(step["src"], step["dst"])
        return {"src": src, "dst": dst}
    if op == "move":
        src, dst = await vfs.move(step["src"], step["dst"])
        return {"src": src, "dst": dst}
    if op == "exists":
        return await vfs.exists(step["path"])
    if op == "isDir":
        return await vfs.is_dir(step["path"])
    if op == "stat":
        return await vfs.stat(step["path"])
    raise AssertionError(f"unsupported op: {op}")


def _normalize_result(result: object) -> object:
    if isinstance(result, bytes):
        return base64.b64encode(result).decode("ascii")
    if hasattr(result, "path") and hasattr(result, "media_type"):
        return {
            "path": result.path,
            "exists": result.exists,
            "isDir": result.is_dir,
            "size": result.size,
            "mediaType": result.media_type,
            "modifiedEpochMs": result.modified_epoch_ms,
        }
    return result


def _policy_from_snapshot(raw: object) -> VfsResourcePolicy | None:
    if raw is None:
        return None
    return VfsResourcePolicy(
        max_file_bytes=raw.get("maxFileBytes"),
        max_total_bytes=raw.get("maxTotalBytes"),
        max_directory_depth=raw.get("maxDirectoryDepth"),
        max_entries_per_directory=raw.get("maxEntriesPerDirectory"),
        max_output_artifact_bytes=raw.get("maxOutputArtifactBytes"),
    )


def _mock_now_ms() -> Callable[[], int]:
    current = 1_700_000_000_000

    def now_ms() -> int:
        nonlocal current
        current += 1
        return current

    return now_ms


def _decode_b64(value: str) -> bytes:
    return base64.b64decode(value)
