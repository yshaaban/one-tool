from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from conftest import SNAPSHOT_ROOT, decode_b64
from onetool.commands import CommandContext, create_command_registry
from onetool.commands.core import maybe_await
from onetool.execution_policy import resolve_execution_policy
from onetool.memory import SimpleMemory
from snapshot_helpers import (
    build_adapters,
    execution_policy_from_snapshot,
    mock_now_ms,
    resource_policy_from_snapshot,
    seed_snapshot_world,
    serialize_command_result,
    snapshot_world_state,
)
from onetool.vfs.memory_vfs import MemoryVFS

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
    now_ms = mock_now_ms()
    registry = create_command_registry()
    command_name = record["command"]
    spec = registry.get(command_name)

    assert spec is not None, _missing_command_message(command_name, registry.names())

    ctx = CommandContext(
        vfs=MemoryVFS(
            resource_policy=resource_policy_from_snapshot(record.get("vfsResourcePolicy")),
            _now_ms=now_ms,
        ),
        adapters=build_adapters(record.get("world")),
        memory=SimpleMemory(_now_ms=now_ms),
        registry=registry,
        execution_policy=resolve_execution_policy(execution_policy_from_snapshot(record.get("executionPolicy"))),
        output_dir="/.system/cmd-output",
        output_counter=0,
    )

    await seed_snapshot_world(ctx.vfs, ctx.memory, record.get("world"))
    result = await maybe_await(spec.handler(ctx, list(record["args"]), decode_b64(record["stdin_b64"])))

    assert serialize_command_result(result) == record["result"]
    assert await snapshot_world_state(ctx.vfs, ctx.memory) == record["worldAfter"]


def _missing_command_message(command_name: str, available_commands: list[str]) -> str:
    return (
        f"command snapshot references unimplemented command {command_name!r}. "
        f"Available commands: {', '.join(available_commands)}"
    )
