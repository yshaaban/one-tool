from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from conftest import SNAPSHOT_ROOT, decode_b64
from onetool.commands import CommandContext, create_command_registry
from onetool.commands.core import maybe_await
from onetool.execution_policy import AgentCLIExecutionPolicy, resolve_execution_policy
from onetool.memory import SimpleMemory
from onetool.testing.adapters import DemoFetch, DemoSearch, DemoSearchDocument
from onetool.types import ToolAdapters
from onetool.utils import looks_binary
from onetool.vfs.memory_vfs import MemoryVFS
from onetool.vfs.policy import VfsResourcePolicy

COMMAND_SNAPSHOT_FILES = sorted((SNAPSHOT_ROOT / "commands").rglob("*.json"))


def test_command_snapshots_exist() -> None:
    assert COMMAND_SNAPSHOT_FILES, "no command snapshots found under snapshots/commands"


@pytest.mark.parametrize(
    "snapshot_path",
    COMMAND_SNAPSHOT_FILES,
    ids=lambda path: str(path.relative_to(SNAPSHOT_ROOT)).replace(".json", ""),
)
def test_command_matches_typescript_snapshot(snapshot_path: Path) -> None:
    record = json.loads(snapshot_path.read_text(encoding="utf-8"))
    asyncio.run(_assert_command_snapshot(record))


async def _assert_command_snapshot(record: dict[str, Any]) -> None:
    now_ms = _mock_now_ms()
    registry = create_command_registry()
    command_name = record["command"]
    spec = registry.get(command_name)

    assert spec is not None, _missing_command_message(command_name, registry.names())

    ctx = CommandContext(
        vfs=MemoryVFS(
            resource_policy=_resource_policy_from_snapshot(record.get("vfsResourcePolicy")),
            _now_ms=now_ms,
        ),
        adapters=_build_adapters(record.get("world")),
        memory=SimpleMemory(_now_ms=now_ms),
        registry=registry,
        execution_policy=resolve_execution_policy(_execution_policy_from_snapshot(record.get("executionPolicy"))),
        output_dir="/.system/cmd-output",
        output_counter=0,
    )

    await _seed_snapshot_world(ctx, record.get("world"))
    result = await maybe_await(spec.handler(ctx, list(record["args"]), decode_b64(record["stdin_b64"])))

    assert _serialize_command_result(result) == record["result"]
    assert await _snapshot_world_state(ctx) == record["worldAfter"]


async def _seed_snapshot_world(ctx: CommandContext, raw_world: Any) -> None:
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
                await ctx.vfs.mkdir(file_path, True)
                continue

            if kind == "text":
                await ctx.vfs.write_bytes(file_path, entry["text"].encode("utf-8"), True)
                continue

            if kind == "bytes":
                await ctx.vfs.write_bytes(file_path, decode_b64(entry["data_b64"]), True)
                continue

            raise AssertionError(f"unsupported snapshot file kind: {kind}")

    memory_items = raw_world.get("memory")
    if isinstance(memory_items, list):
        for item in memory_items:
            ctx.memory.store(item)


def _missing_command_message(command_name: str, available_commands: list[str]) -> str:
    return (
        f"command snapshot references unimplemented command {command_name!r}. "
        f"Available commands: {', '.join(available_commands)}"
    )


def _build_adapters(raw_world: Any) -> ToolAdapters:
    if not isinstance(raw_world, dict):
        return ToolAdapters()

    adapters = {}
    search_docs = raw_world.get("searchDocs")
    if isinstance(search_docs, list):
        adapters["search"] = DemoSearch(
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
        adapters["fetch"] = DemoFetch(
            {
                key: _decode_fetch_payload(value)
                for key, value in fetch_resources.items()
            }
        )

    return ToolAdapters(
        search=adapters.get("search"),
        fetch=adapters.get("fetch"),
    )


def _decode_fetch_payload(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    kind = value.get("kind")
    if kind == "bytes" and set(value) == {"kind", "data_b64"}:
        return decode_b64(value["data_b64"])
    if kind == "undefined" and set(value) == {"kind"}:
        return None
    return {key: _decode_fetch_payload(payload) for key, payload in value.items()}


def _execution_policy_from_snapshot(raw: Any) -> AgentCLIExecutionPolicy | None:
    if not isinstance(raw, dict):
        return None
    return AgentCLIExecutionPolicy(
        max_materialized_bytes=raw.get("maxMaterializedBytes"),
    )


def _resource_policy_from_snapshot(raw: Any) -> VfsResourcePolicy | None:
    if not isinstance(raw, dict):
        return None
    return VfsResourcePolicy(
        max_file_bytes=raw.get("maxFileBytes"),
        max_total_bytes=raw.get("maxTotalBytes"),
        max_directory_depth=raw.get("maxDirectoryDepth"),
        max_entries_per_directory=raw.get("maxEntriesPerDirectory"),
        max_output_artifact_bytes=raw.get("maxOutputArtifactBytes"),
    )


def _serialize_command_result(result: Any) -> dict[str, Any]:
    serialized = {
        "stdout_b64": _encode_b64(result.stdout),
        "stderr": result.stderr,
        "exitCode": result.exit_code,
        "contentType": result.content_type,
    }
    if result.stdout and not looks_binary(result.stdout):
        serialized["stdout_text"] = result.stdout.decode("utf-8")
    return serialized


async def _snapshot_world_state(ctx: CommandContext) -> dict[str, Any]:
    return {
        "files": await _snapshot_vfs_entries(ctx.vfs),
        "memory": _snapshot_memory_items(ctx.memory),
    }


async def _snapshot_vfs_entries(vfs: MemoryVFS) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []

    async def walk(dir_path: str) -> None:
        for child in await vfs.listdir(dir_path):
            is_dir = child.endswith("/")
            name = child[:-1] if is_dir else child
            full_path = f"/{name}" if dir_path == "/" else f"{dir_path}/{name}"

            if is_dir:
                entries.append(
                    {
                        "path": full_path,
                        "kind": "dir",
                    }
                )
                await walk(full_path)
                continue

            data = await vfs.read_bytes(full_path)
            if looks_binary(data):
                entries.append(
                    {
                        "path": full_path,
                        "kind": "bytes",
                        "data_b64": _encode_b64(data),
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


def _encode_b64(data: bytes) -> str:
    import base64

    return base64.b64encode(data).decode("ascii")


def _mock_now_ms() -> Any:
    current = 1_700_000_000_000

    def now_ms() -> int:
        nonlocal current
        current += 1
        return current

    return now_ms
