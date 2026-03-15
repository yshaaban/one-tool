from __future__ import annotations

import base64
import re
from typing import Any

from onetool.execution_policy import AgentCLIExecutionPolicy
from onetool.memory import SimpleMemory
from onetool.testing.adapters import DemoFetch, DemoSearch, DemoSearchDocument
from onetool.types import ToolAdapters
from onetool.utils import looks_binary
from onetool.vfs.memory_vfs import MemoryVFS
from onetool.vfs.policy import VfsResourcePolicy


def mock_now_ms() -> Any:
    current = 1_700_000_000_000

    def now_ms() -> int:
        nonlocal current
        current += 1
        return current

    return now_ms


def execution_policy_from_snapshot(raw: Any) -> AgentCLIExecutionPolicy | None:
    if not isinstance(raw, dict):
        return None
    return AgentCLIExecutionPolicy(max_materialized_bytes=raw.get("maxMaterializedBytes"))


def resource_policy_from_snapshot(raw: Any) -> VfsResourcePolicy | None:
    if not isinstance(raw, dict):
        return None
    return VfsResourcePolicy(
        max_file_bytes=raw.get("maxFileBytes"),
        max_total_bytes=raw.get("maxTotalBytes"),
        max_directory_depth=raw.get("maxDirectoryDepth"),
        max_entries_per_directory=raw.get("maxEntriesPerDirectory"),
        max_output_artifact_bytes=raw.get("maxOutputArtifactBytes"),
    )


def build_adapters(raw_world: Any) -> ToolAdapters:
    if not isinstance(raw_world, dict):
        return ToolAdapters()

    adapters = ToolAdapters()
    search_docs = raw_world.get("searchDocs")
    if isinstance(search_docs, list):
        adapters.search = DemoSearch(
            [
                DemoSearchDocument(
                    title=doc["title"],
                    body=doc["body"],
                    source=doc["source"],
                )
                for doc in search_docs
            ]
        )

    fetch_resources = raw_world.get("fetchResources")
    if isinstance(fetch_resources, dict):
        adapters.fetch = DemoFetch(
            {
                resource: decode_fetch_payload(payload)
                for resource, payload in fetch_resources.items()
            }
        )

    return adapters


async def seed_snapshot_world(vfs: MemoryVFS, memory: SimpleMemory, raw_world: Any) -> None:
    if not isinstance(raw_world, dict):
        return

    files = raw_world.get("files")
    if isinstance(files, dict):
        for file_path in sorted(files):
            entry = files[file_path]
            if not isinstance(entry, dict):
                continue
            kind = entry.get("kind")
            if kind == "dir":
                await vfs.mkdir(file_path, True)
                continue
            if kind == "text":
                await vfs.write_bytes(file_path, entry["text"].encode("utf-8"), True)
                continue
            if kind == "bytes":
                await vfs.write_bytes(file_path, decode_b64(entry["data_b64"]), True)
                continue
            raise AssertionError(f"unsupported snapshot file kind: {kind}")

    memory_items = raw_world.get("memory")
    if isinstance(memory_items, list):
        for item in memory_items:
            memory.store(item)


def serialize_command_result(result: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "stdout_b64": to_base64(result.stdout),
        "stderr": result.stderr,
        "exitCode": result.exit_code,
        "contentType": result.content_type,
    }
    if result.stdout and not looks_binary(result.stdout):
        payload["stdout_text"] = result.stdout.decode("utf-8")
    return payload


def serialize_run_execution(execution: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "exitCode": execution.exit_code,
        "stdout_b64": to_base64(execution.stdout),
        "stderr": execution.stderr,
        "contentType": execution.content_type,
        "trace": [_serialize_pipeline_trace(item) for item in execution.trace],
        "presentation": _serialize_presentation(execution.presentation),
    }
    if execution.stdout and not looks_binary(execution.stdout):
        payload["stdout_text"] = execution.stdout.decode("utf-8")
    return payload


async def snapshot_world_state(vfs: MemoryVFS, memory: SimpleMemory) -> dict[str, Any]:
    return {
        "files": await _snapshot_vfs_entries(vfs),
        "memory": _snapshot_memory_items(memory),
    }


def normalize_presentation_text(text: str) -> str:
    return re.sub(r"\[exit:(-?\d+) \| [^\]]+\]$", r"[exit:\1 | 0ms]", text)


def decode_fetch_payload(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    kind = value.get("kind")
    if kind == "bytes" and set(value) == {"kind", "data_b64"}:
        return decode_b64(value["data_b64"])
    if kind == "undefined" and set(value) == {"kind"}:
        return None
    return {
        key: decode_fetch_payload(payload)
        for key, payload in value.items()
    }


def decode_b64(value: str) -> bytes:
    if value == "":
        return b""
    return base64.b64decode(value.encode("ascii"))


def to_base64(data: bytes) -> str:
    if not data:
        return ""
    return base64.b64encode(data).decode("ascii")


def _serialize_pipeline_trace(trace: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "relationFromPrevious": trace.relation_from_previous,
        "executed": trace.executed,
        "commands": [
            {
                "argv": list(command_trace.argv),
                "stdinBytes": command_trace.stdin_bytes,
                "stdoutBytes": command_trace.stdout_bytes,
                "stderr": command_trace.stderr,
                "exitCode": command_trace.exit_code,
                "contentType": command_trace.content_type,
            }
            for command_trace in trace.commands
        ],
    }
    if trace.skipped_reason is not None:
        payload["skippedReason"] = trace.skipped_reason
    if trace.exit_code is not None:
        payload["exitCode"] = trace.exit_code
    return payload


def _serialize_presentation(presentation: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "text": normalize_presentation_text(presentation.text),
        "body": presentation.body,
        "stdoutMode": presentation.stdout_mode,
    }
    if presentation.saved_path is not None:
        payload["savedPath"] = presentation.saved_path
    if presentation.total_bytes is not None:
        payload["totalBytes"] = presentation.total_bytes
    if presentation.total_lines is not None:
        payload["totalLines"] = presentation.total_lines
    return payload


async def _snapshot_vfs_entries(vfs: MemoryVFS) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []

    async def walk(dir_path: str) -> None:
        for child in await vfs.listdir(dir_path):
            is_dir = child.endswith("/")
            name = child[:-1] if is_dir else child
            full_path = f"/{name}" if dir_path == "/" else f"{dir_path}/{name}"

            if is_dir:
                entries.append({"path": full_path, "kind": "dir"})
                await walk(full_path)
                continue

            data = await vfs.read_bytes(full_path)
            if looks_binary(data):
                entries.append(
                    {
                        "path": full_path,
                        "kind": "bytes",
                        "data_b64": to_base64(data),
                    }
                )
                continue

            entries.append(
                {
                    "path": full_path,
                    "kind": "text",
                    "text": data.decode("utf-8"),
                }
            )

    await walk("/")
    return entries


def _snapshot_memory_items(memory: SimpleMemory) -> list[dict[str, Any]]:
    items = memory.recent(2**31 - 1)
    items.reverse()
    return [
        {
            "id": item.id,
            "text": item.text,
            "createdEpochMs": item.created_epoch_ms,
            "metadata": item.metadata,
        }
        for item in items
    ]
