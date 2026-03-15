from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from conftest import ROOT_DIR
from onetool.commands import CommandSpec
from onetool.memory import SimpleMemory
from onetool.runtime import AgentCLI
from onetool.types import err, ok, ok_bytes
from snapshot_helpers import (
    build_adapters,
    execution_policy_from_snapshot,
    mock_now_ms,
    resource_policy_from_snapshot,
    seed_snapshot_world,
    serialize_run_execution,
    snapshot_world_state,
)
from onetool.vfs.memory_vfs import MemoryVFS
from runtime_fixture_commands import runtime_fixture_commands

RUNTIME_SNAPSHOT_ROOT = ROOT_DIR / "snapshots" / "runtime"
RUNTIME_EXECUTION_SNAPSHOTS = sorted((RUNTIME_SNAPSHOT_ROOT / "executions").glob("*.json"))
RUNTIME_DESCRIPTION_SNAPSHOTS = sorted((RUNTIME_SNAPSHOT_ROOT / "descriptions").glob("*.json"))


@pytest.mark.parametrize(
    "snapshot_path",
    RUNTIME_EXECUTION_SNAPSHOTS,
    ids=[path.stem for path in RUNTIME_EXECUTION_SNAPSHOTS],
)
def test_runtime_execution_snapshots_match_golden(snapshot_path: Path) -> None:
    record = json.loads(snapshot_path.read_text(encoding="utf-8"))
    asyncio.run(_assert_runtime_execution_snapshot(record))


@pytest.mark.parametrize(
    "snapshot_path",
    RUNTIME_DESCRIPTION_SNAPSHOTS,
    ids=[path.stem for path in RUNTIME_DESCRIPTION_SNAPSHOTS],
)
def test_runtime_description_snapshots_match_golden(snapshot_path: Path) -> None:
    record = json.loads(snapshot_path.read_text(encoding="utf-8"))
    asyncio.run(_assert_runtime_description_snapshot(record))


async def _assert_runtime_execution_snapshot(record: dict[str, Any]) -> None:
    runtime = await _create_snapshot_runtime(record)
    execution = await runtime.run_detailed(record["commandLine"])

    assert serialize_run_execution(execution) == record["execution"]
    assert await snapshot_world_state(runtime.ctx.vfs, runtime.ctx.memory) == record["worldAfter"]


async def _assert_runtime_description_snapshot(record: dict[str, Any]) -> None:
    runtime = await _create_snapshot_runtime(record)
    assert runtime.build_tool_description(record["variant"]) == record["description"]


async def _create_snapshot_runtime(record: dict[str, Any]) -> AgentCLI:
    now_ms = mock_now_ms()
    vfs = MemoryVFS(
        resource_policy=resource_policy_from_snapshot(record.get("vfsResourcePolicy")),
        _now_ms=now_ms,
    )
    memory = SimpleMemory(_now_ms=now_ms)
    await seed_snapshot_world(vfs, memory, record.get("world"))

    runtime = AgentCLI(
        vfs=vfs,
        adapters=build_adapters(record.get("world")),
        memory=memory,
        builtin_commands=record.get("builtinCommands"),
        commands=runtime_fixture_commands(record.get("customCommands", [])),
        output_limits=record.get("outputLimits"),
        execution_policy=execution_policy_from_snapshot(record.get("executionPolicy")),
    )
    await runtime.initialize()
    return runtime
