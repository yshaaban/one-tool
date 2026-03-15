from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from conftest import ROOT_DIR, decode_b64
from onetool.memory import SimpleMemory
from onetool.runtime import AgentCLIOutputLimits
from onetool.testing import (
    AssertionSpec,
    DemoSearchDocument,
    FileAssertionSpec,
    MemoryAssertionSpec,
    OracleCommandSpec,
    ScenarioSpec,
    TextAssertionSpec,
    TraceAssertionSpec,
    TraceStepAssertionSpec,
    WorldSpec,
    assert_scenario,
    build_world,
    run_oracle,
)
from onetool.utils import looks_binary
from onetool.vfs.memory_vfs import MemoryVFS

SCENARIO_SNAPSHOT_ROOT = ROOT_DIR / "snapshots" / "scenarios"
SCENARIO_SNAPSHOT_FILES = sorted(SCENARIO_SNAPSHOT_ROOT.glob("*.json"))


@pytest.mark.parametrize(
    "snapshot_path",
    SCENARIO_SNAPSHOT_FILES,
    ids=[path.stem for path in SCENARIO_SNAPSHOT_FILES],
)
def test_scenario_matches_typescript_snapshot(snapshot_path: Path) -> None:
    record = json.loads(snapshot_path.read_text(encoding="utf-8"))
    asyncio.run(_assert_scenario_snapshot(record))


async def _assert_scenario_snapshot(record: dict[str, Any]) -> None:
    now_ms = _mock_now_ms()
    scenario = _scenario_from_snapshot(record["scenario"])
    vfs = MemoryVFS(_now_ms=now_ms)
    memory = SimpleMemory(_now_ms=now_ms)
    runtime = await build_world(scenario.world, vfs=vfs, memory=memory)

    trace = await run_oracle(runtime, scenario)
    assertion_result = await assert_scenario(scenario, trace, runtime)

    assert _serialize_oracle_trace(trace) == record["trace"]
    assert _serialize_assertion_result(assertion_result) == record["assertionResult"]
    assert await _snapshot_world_state(runtime.ctx.vfs, runtime.ctx.memory) == record["worldAfter"]


def _scenario_from_snapshot(raw: dict[str, Any]) -> ScenarioSpec:
    return ScenarioSpec(
        id=raw["id"],
        category=raw["category"],
        description=raw["description"],
        prompt=raw["prompt"],
        max_turns=raw["maxTurns"],
        max_tool_calls=raw["maxToolCalls"],
        world=_world_from_snapshot(raw["world"]),
        assertions=_assertions_from_snapshot(raw["assertions"]),
        prompt_variant=raw.get("promptVariant"),
        repeats=raw.get("repeats"),
        oracle=_oracle_from_snapshot(raw.get("oracle")),
    )


def _world_from_snapshot(raw: dict[str, Any]) -> WorldSpec:
    files: dict[str, str | bytes] | None = None
    raw_files = raw.get("files")
    if isinstance(raw_files, dict):
        files = {}
        for file_path, entry in raw_files.items():
            if not isinstance(entry, dict):
                continue
            kind = entry.get("kind")
            if kind == "text":
                files[file_path] = entry["text"]
                continue
            if kind == "bytes":
                files[file_path] = decode_b64(entry["data_b64"])
                continue
            raise AssertionError(f"scenario world files do not support entry kind: {kind}")

    search_docs = None
    raw_search_docs = raw.get("searchDocs")
    if isinstance(raw_search_docs, list):
        search_docs = [
            DemoSearchDocument(
                title=doc["title"],
                body=doc["body"],
                source=doc["source"],
            )
            for doc in raw_search_docs
        ]

    fetch_resources = None
    raw_fetch_resources = raw.get("fetchResources")
    if isinstance(raw_fetch_resources, dict):
        fetch_resources = {
            resource: _decode_fetch_payload(payload)
            for resource, payload in raw_fetch_resources.items()
        }

    output_limits = None
    raw_output_limits = raw.get("outputLimits")
    if isinstance(raw_output_limits, dict):
        output_limits = AgentCLIOutputLimits(
            max_lines=raw_output_limits.get("maxLines"),
            max_bytes=raw_output_limits.get("maxBytes"),
        )

    return WorldSpec(
        files=files,
        search_docs=search_docs,
        fetch_resources=fetch_resources,
        memory=list(raw["memory"]) if isinstance(raw.get("memory"), list) else None,
        output_limits=output_limits,
    )


def _assertions_from_snapshot(raw: dict[str, Any]) -> AssertionSpec:
    files = raw.get("files")
    trace = raw.get("trace")
    return AssertionSpec(
        final_answer=_text_assertion_from_snapshot(raw.get("finalAnswer")),
        files=[_file_assertion_from_snapshot(item) for item in files] if isinstance(files, list) else None,
        memory=_memory_assertion_from_snapshot(raw.get("memory")),
        trace=_trace_assertion_from_snapshot(trace),
    )


def _text_assertion_from_snapshot(raw: Any) -> TextAssertionSpec | None:
    if not isinstance(raw, dict):
        return None
    return TextAssertionSpec(
        exact=raw.get("exact"),
        contains=list(raw["contains"]) if isinstance(raw.get("contains"), list) else None,
        not_contains=list(raw["notContains"]) if isinstance(raw.get("notContains"), list) else None,
        regex=list(raw["regex"]) if isinstance(raw.get("regex"), list) else None,
    )


def _file_assertion_from_snapshot(raw: dict[str, Any]) -> FileAssertionSpec:
    text = _text_assertion_from_snapshot(raw)
    return FileAssertionSpec(
        path=raw["path"],
        exists=raw.get("exists"),
        exact=None if text is None else text.exact,
        contains=None if text is None else text.contains,
        not_contains=None if text is None else text.not_contains,
        regex=None if text is None else text.regex,
    )


def _memory_assertion_from_snapshot(raw: Any) -> MemoryAssertionSpec | None:
    if not isinstance(raw, dict):
        return None
    contains = raw.get("contains")
    return MemoryAssertionSpec(
        contains=list(contains) if isinstance(contains, list) else None,
    )


def _trace_assertion_from_snapshot(raw: Any) -> TraceAssertionSpec | None:
    if not isinstance(raw, dict):
        return None
    steps = raw.get("steps")
    return TraceAssertionSpec(
        must_include=list(raw["mustInclude"]) if isinstance(raw.get("mustInclude"), list) else None,
        forbidden=list(raw["forbidden"]) if isinstance(raw.get("forbidden"), list) else None,
        max_calls=raw.get("maxCalls"),
        steps=[_trace_step_assertion_from_snapshot(item) for item in steps] if isinstance(steps, list) else None,
    )


def _trace_step_assertion_from_snapshot(raw: dict[str, Any]) -> TraceStepAssertionSpec:
    text = _text_assertion_from_snapshot(raw)
    return TraceStepAssertionSpec(
        index=raw["index"],
        exit_code=raw.get("exitCode"),
        exact=None if text is None else text.exact,
        contains=None if text is None else text.contains,
        not_contains=None if text is None else text.not_contains,
        regex=None if text is None else text.regex,
    )


def _oracle_from_snapshot(raw: Any) -> list[str | OracleCommandSpec]:
    if not isinstance(raw, list):
        return []
    steps: list[str | OracleCommandSpec] = []
    for item in raw:
        if isinstance(item, str):
            steps.append(item)
            continue
        if isinstance(item, dict):
            steps.append(
                OracleCommandSpec(
                    command=item["command"],
                    expected_exit_code=item.get("expectedExitCode"),
                )
            )
            continue
        raise AssertionError(f"unsupported oracle step: {item!r}")
    return steps


def _decode_fetch_payload(value: Any) -> Any:
    if not isinstance(value, dict):
        return value
    kind = value.get("kind")
    if kind == "bytes":
        return decode_b64(value["data_b64"])
    if kind == "undefined":
        return None
    return {
        key: _decode_fetch_payload(payload)
        for key, payload in value.items()
    }


def _serialize_oracle_trace(trace: Any) -> dict[str, Any]:
    return {
        "scenarioId": trace.scenario_id,
        "steps": [
            {
                "command": step.command,
                "output": _normalize_presentation_text(step.output),
                "body": step.body,
                "exitCode": step.exit_code,
                "expectedExitCode": step.expected_exit_code,
                "execution": _serialize_run_execution(step.execution),
            }
            for step in trace.steps
        ],
        "finalOutput": _normalize_presentation_text(trace.final_output),
        "finalBody": trace.final_body,
        "finalExitCode": trace.final_exit_code,
    }


def _serialize_assertion_result(result: Any) -> dict[str, Any]:
    return {
        "passed": result.passed,
        "failures": list(result.failures),
    }


def _serialize_run_execution(execution: Any) -> dict[str, Any]:
    payload = {
        "exitCode": execution.exit_code,
        "stdout_b64": _to_base64(execution.stdout),
        "stderr": execution.stderr,
        "contentType": execution.content_type,
        "trace": [_serialize_pipeline_trace(item) for item in execution.trace],
        "presentation": {
            "text": _normalize_presentation_text(execution.presentation.text),
            "body": execution.presentation.body,
            "stdoutMode": execution.presentation.stdout_mode,
        },
    }
    if execution.stdout and not looks_binary(execution.stdout):
        payload["stdout_text"] = execution.stdout.decode("utf-8")
    if execution.presentation.saved_path is not None:
        payload["presentation"]["savedPath"] = execution.presentation.saved_path
    if execution.presentation.total_bytes is not None:
        payload["presentation"]["totalBytes"] = execution.presentation.total_bytes
    if execution.presentation.total_lines is not None:
        payload["presentation"]["totalLines"] = execution.presentation.total_lines
    return payload


def _serialize_pipeline_trace(trace: Any) -> dict[str, Any]:
    payload = {
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


async def _snapshot_world_state(vfs: MemoryVFS, memory: SimpleMemory) -> dict[str, Any]:
    return {
        "files": await _snapshot_vfs_entries(vfs),
        "memory": _snapshot_memory_items(memory),
    }


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
                        "data_b64": _to_base64(data),
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


def _normalize_presentation_text(text: str) -> str:
    import re

    return re.sub(r"\[exit:(-?\d+) \| [^\]]+\]$", r"[exit:\1 | 0ms]", text)


def _mock_now_ms() -> Any:
    current = 1_700_000_000_000

    def now_ms() -> int:
        nonlocal current
        current += 1
        return current

    return now_ms


def _to_base64(data: bytes) -> str:
    import base64

    return base64.b64encode(data).decode("ascii")
