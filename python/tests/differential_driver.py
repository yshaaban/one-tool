from __future__ import annotations

import asyncio
import json
from pathlib import Path
import sys
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[2]
SRC_ROOT = ROOT_DIR / "python" / "src"

if str(SRC_ROOT) not in sys.path:
    sys.path.insert(0, str(SRC_ROOT))

from onetool.memory import SimpleMemory
from onetool.runtime import AgentCLI
from onetool.testing.command_harness import (
    CreateTestCommandContextOptions,
    RunRegisteredCommandOptions,
    create_test_command_context,
    run_registered_command,
)
from onetool.vfs.memory_vfs import MemoryVFS
from runtime_fixture_commands import runtime_fixture_commands
from snapshot_helpers import (
    build_adapters,
    decode_b64,
    execution_policy_from_snapshot,
    mock_now_ms,
    resource_policy_from_snapshot,
    seed_snapshot_world,
    serialize_command_result,
    serialize_run_execution,
    snapshot_world_state,
)


def main() -> int:
    request = json.load(sys.stdin)
    response = asyncio.run(handle_request(request))
    json.dump(response, sys.stdout)
    return 0


async def handle_request(request: dict[str, Any]) -> dict[str, Any]:
    kind = request.get("kind")
    if kind == "command-snapshot-records":
        return {
            "results": [
                await run_command_snapshot_record(record)
                for record in request.get("records", [])
            ]
        }
    if kind == "runtime-execution-records":
        return {
            "results": [
                await run_runtime_execution_record(record)
                for record in request.get("records", [])
            ]
        }
    if kind == "runtime-description-records":
        return {
            "results": [
                await run_runtime_description_record(record)
                for record in request.get("records", [])
            ]
        }
    if kind == "runtime-workflows":
        return {
            "results": [
                await run_runtime_workflow(workflow)
                for workflow in request.get("workflows", [])
            ]
        }
    raise ValueError(f"unsupported differential driver request kind: {kind}")


async def run_command_snapshot_record(record: dict[str, Any]) -> dict[str, Any]:
    now_ms = mock_now_ms()
    vfs = MemoryVFS(
        resource_policy=resource_policy_from_snapshot(record.get("vfsResourcePolicy")),
        _now_ms=now_ms,
    )
    memory = SimpleMemory(_now_ms=now_ms)
    ctx = create_test_command_context(
        CreateTestCommandContextOptions(
            vfs=vfs,
            adapters=build_adapters(record.get("world")),
            memory=memory,
            execution_policy=execution_policy_from_snapshot(record.get("executionPolicy")),
            output_dir="/.system/cmd-output",
            output_counter=0,
        )
    )

    await seed_snapshot_world(vfs, memory, record.get("world"))
    run_result = await run_registered_command(
        record["command"],
        record["args"],
        RunRegisteredCommandOptions(
            ctx=ctx,
            stdin=decode_b64(record.get("stdin_b64", "")),
        ),
    )

    return {
        "result": serialize_command_result(run_result.result),
        "worldAfter": await snapshot_world_state(vfs, memory),
    }


async def run_runtime_execution_record(record: dict[str, Any]) -> dict[str, Any]:
    runtime = await create_snapshot_runtime(record)
    execution = await runtime.run_detailed(record["commandLine"])
    return {
        "execution": serialize_run_execution(execution),
        "worldAfter": await snapshot_world_state(runtime.ctx.vfs, runtime.ctx.memory),
    }


async def run_runtime_description_record(record: dict[str, Any]) -> dict[str, Any]:
    runtime = await create_snapshot_runtime(record)
    return {
        "description": runtime.build_tool_description(record["variant"]),
    }


async def run_runtime_workflow(workflow: dict[str, Any]) -> dict[str, Any]:
    runtime = await create_snapshot_runtime({})
    executions = await _run_runtime_commands(runtime, workflow.get("setupCommands", []))
    executions.extend(await _run_runtime_commands(runtime, workflow.get("commands", [])))

    return {
        "executions": executions,
        "worldAfter": await snapshot_world_state(runtime.ctx.vfs, runtime.ctx.memory),
    }


async def create_snapshot_runtime(record: dict[str, Any]) -> AgentCLI:
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


async def _run_runtime_commands(runtime: AgentCLI, command_lines: list[str]) -> list[dict[str, Any]]:
    executions: list[dict[str, Any]] = []

    for command_line in command_lines:
        execution = await runtime.run_detailed(command_line)
        executions.append(serialize_run_execution(execution))

    return executions


if __name__ == "__main__":
    raise SystemExit(main())
