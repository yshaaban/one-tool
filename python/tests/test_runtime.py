from __future__ import annotations

import pytest

from onetool.commands.groups.system import help_command
from onetool.runtime import AgentCLI
from onetool.types import err, ok, ok_bytes
from onetool.vfs.memory_vfs import MemoryVFS
from onetool.vfs.policy import VfsResourcePolicy


echo = help_command.__class__(
    name="echo",
    summary="Echo text.",
    usage="echo <text...>",
    details="Examples:\n  echo hello",
    handler=lambda _ctx, args, _stdin: ok(" ".join(args)),
)

fail = help_command.__class__(
    name="fail",
    summary="Fail immediately.",
    usage="fail",
    details="Examples:\n  fail",
    handler=lambda _ctx, _args, _stdin: err("fail: forced failure"),
)

burst = help_command.__class__(
    name="burst",
    summary="Emit three lines.",
    usage="burst",
    details="Examples:\n  burst",
    handler=lambda _ctx, _args, _stdin: ok("first line\nsecond line\nthird line"),
)

binary = help_command.__class__(
    name="binary",
    summary="Emit binary bytes.",
    usage="binary",
    details="Examples:\n  binary",
    handler=lambda _ctx, _args, _stdin: ok_bytes(bytes([0, 1, 2, 3]), "application/octet-stream"),
)


@pytest.mark.asyncio
async def test_run_detailed_returns_chain_and_command_traces_with_skip_metadata() -> None:
    runtime = AgentCLI(vfs=MemoryVFS(), builtin_commands=False, commands=(echo, fail))
    await runtime.initialize()

    execution = await runtime.run_detailed("echo ok || echo skipped; fail && echo skipped2; echo final")

    assert execution.exit_code == 0
    assert execution.stdout.decode("utf-8") == "ok\nfinal"
    assert len(execution.trace) == 5

    assert execution.trace[0].executed is True
    assert execution.trace[0].exit_code == 0
    assert execution.trace[0].commands[0].argv == ["echo", "ok"]

    assert execution.trace[1].executed is False
    assert execution.trace[1].skipped_reason == "previous_succeeded"

    assert execution.trace[2].executed is True
    assert execution.trace[2].exit_code == 1
    assert execution.trace[2].commands[0].stderr == "fail: forced failure"

    assert execution.trace[3].executed is False
    assert execution.trace[3].skipped_reason == "previous_failed"

    assert execution.trace[4].executed is True
    assert execution.trace[4].commands[0].argv == ["echo", "final"]
    assert execution.presentation.stdout_mode == "plain"
    assert "[exit:0 | " in execution.presentation.text


@pytest.mark.asyncio
async def test_run_detailed_captures_unknown_commands_as_structured_failures() -> None:
    runtime = AgentCLI(vfs=MemoryVFS(), builtin_commands=False)
    await runtime.initialize()

    execution = await runtime.run_detailed("missingcmd arg")

    assert execution.exit_code == 127
    assert len(execution.trace) == 1
    assert execution.trace[0].commands[0].argv == ["missingcmd", "arg"]
    assert execution.trace[0].commands[0].exit_code == 127
    assert "unknown command: missingcmd" in execution.stderr
    assert "[error] unknown command: missingcmd" in execution.presentation.body


@pytest.mark.asyncio
async def test_run_detailed_reports_parse_errors_without_command_traces() -> None:
    runtime = AgentCLI(vfs=MemoryVFS(), builtin_commands=False, commands=(echo,))
    await runtime.initialize()

    execution = await runtime.run_detailed('echo "unterminated')

    assert execution.exit_code == 2
    assert execution.trace == []
    assert execution.stdout == b""
    assert "[error]" in execution.presentation.body
    assert "[exit:2 | " in execution.presentation.text


@pytest.mark.asyncio
async def test_run_detailed_exposes_truncation_metadata() -> None:
    runtime = AgentCLI(
        vfs=MemoryVFS(),
        builtin_commands=False,
        commands=(burst,),
        output_limits={"max_lines": 1, "max_bytes": 1024},
    )
    await runtime.initialize()

    execution = await runtime.run_detailed("burst")

    assert execution.presentation.stdout_mode == "truncated"
    assert execution.presentation.total_lines == 3
    assert (execution.presentation.total_bytes or 0) > 0
    assert await runtime.ctx.vfs.exists(execution.presentation.saved_path or "") is True
    assert "output truncated (3 lines," in execution.presentation.body
    assert execution.stdout.decode("utf-8") == "first line\nsecond line\nthird line"


@pytest.mark.asyncio
async def test_run_returns_same_presentation_text_as_run_detailed() -> None:
    runtime = AgentCLI(vfs=MemoryVFS(), builtin_commands=False, commands=(echo,))
    await runtime.initialize()

    execution = await runtime.run_detailed("echo hello world")
    text = await runtime.run("echo hello world")

    assert text == execution.presentation.text


@pytest.mark.asyncio
async def test_run_detailed_exposes_binary_guard_metadata() -> None:
    runtime = AgentCLI(vfs=MemoryVFS(), builtin_commands=False, commands=(binary,))
    await runtime.initialize()

    execution = await runtime.run_detailed("binary")

    assert execution.presentation.stdout_mode == "binary-guard"
    assert execution.presentation.total_bytes == 4
    assert (execution.presentation.saved_path or "").endswith(".bin")
    assert await runtime.ctx.vfs.exists(execution.presentation.saved_path or "") is True
    assert "command produced binary output" in execution.presentation.body
    assert execution.stdout == bytes([0, 1, 2, 3])


@pytest.mark.asyncio
async def test_run_detailed_degrades_gracefully_when_truncated_output_cannot_be_saved() -> None:
    runtime = AgentCLI(
        vfs=MemoryVFS(resource_policy=VfsResourcePolicy(max_output_artifact_bytes=8)),
        builtin_commands=False,
        commands=(burst,),
        output_limits={"max_lines": 1, "max_bytes": 1024},
    )
    await runtime.initialize()

    execution = await runtime.run_detailed("burst")

    assert execution.exit_code == 0
    assert execution.presentation.stdout_mode == "truncated"
    assert execution.presentation.saved_path is None
    assert "output truncated (3 lines," in execution.presentation.body
    assert "Full output could not be saved because maxOutputArtifactBytes was exceeded" in execution.presentation.body


@pytest.mark.asyncio
async def test_run_detailed_degrades_gracefully_when_binary_output_cannot_be_saved() -> None:
    runtime = AgentCLI(
        vfs=MemoryVFS(resource_policy=VfsResourcePolicy(max_output_artifact_bytes=3)),
        builtin_commands=False,
        commands=(binary,),
    )
    await runtime.initialize()

    execution = await runtime.run_detailed("binary")

    assert execution.exit_code == 0
    assert execution.presentation.stdout_mode == "binary-guard"
    assert execution.presentation.saved_path is None
    assert "command produced binary output" in execution.presentation.body
    assert "Full output could not be saved because maxOutputArtifactBytes was exceeded" in execution.presentation.body


@pytest.mark.asyncio
async def test_build_tool_description_variants_follow_registry_shape() -> None:
    runtime = AgentCLI(vfs=MemoryVFS(), builtin_commands=False, commands=(help_command, echo))
    await runtime.initialize()

    full = runtime.build_tool_description()
    minimal = runtime.build_tool_description("minimal-tool-description")
    terse = runtime.build_tool_description("terse")

    assert "Available commands:" in full
    assert "echo     — Echo text." in full
    assert "run 'help' to list commands" in minimal
    assert "detailed command catalog omitted in this variant" in minimal
    assert "Available commands:" not in minimal
    assert "\n  echo\n" in terse


@pytest.mark.asyncio
async def test_build_tool_description_omits_help_discovery_when_help_is_missing() -> None:
    runtime = AgentCLI(vfs=MemoryVFS(), builtin_commands=False, commands=(echo,))
    await runtime.initialize()

    minimal = runtime.build_tool_description("minimal-tool-description")
    terse = runtime.build_tool_description("terse")

    assert "run 'help' to list commands" not in minimal
    assert "available command names:" in minimal
    assert "\n      echo\n" in minimal or minimal.endswith("      echo")
    assert "run 'help' to list commands" not in terse


def test_agent_cli_rejects_invalid_output_limit_values() -> None:
    with pytest.raises(ValueError, match=r"output_limits\.max_lines must be a non-negative integer"):
        AgentCLI(vfs=MemoryVFS(), output_limits={"max_lines": -1})

    with pytest.raises(ValueError, match=r"output_limits\.max_bytes must be a non-negative integer"):
        AgentCLI(vfs=MemoryVFS(), output_limits={"max_bytes": -1})


def test_agent_cli_rejects_mixing_registry_with_other_registration_options() -> None:
    registry = runtime = AgentCLI(vfs=MemoryVFS(), builtin_commands=False).registry

    with pytest.raises(ValueError, match="registry cannot be combined with commands"):
        AgentCLI(vfs=MemoryVFS(), registry=registry, commands=(echo,))

    with pytest.raises(ValueError, match="registry cannot be combined with builtin_commands"):
        AgentCLI(vfs=MemoryVFS(), registry=registry, builtin_commands=False)
