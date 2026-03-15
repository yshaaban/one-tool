from __future__ import annotations

import pytest

from onetool.commands.groups.system import help_command
from onetool.runtime import AgentCLI
from onetool.tool_schema import BuildToolDefinitionOptions, build_tool_definition
from onetool.types import ok
from onetool.vfs.memory_vfs import MemoryVFS


echo = help_command.__class__(
    name="echo",
    summary="Echo text back.",
    usage="echo <text...>",
    details="Examples:\n  echo hello",
    handler=lambda _ctx, args, _stdin: ok(" ".join(args)),
)


@pytest.mark.asyncio
async def test_build_tool_definition_uses_runtime_descriptions() -> None:
    runtime = AgentCLI(vfs=MemoryVFS(), builtin_commands=False, commands=(help_command, echo))
    await runtime.initialize()

    default_tool = build_tool_definition(runtime)
    minimal_tool = build_tool_definition(
        runtime,
        "run",
        BuildToolDefinitionOptions(description_variant="minimal-tool-description"),
    )
    terse_tool = build_tool_definition(
        runtime,
        "run",
        BuildToolDefinitionOptions(description_variant="terse"),
    )

    assert default_tool["function"]["description"] == runtime.build_tool_description()
    assert minimal_tool["function"]["description"] == runtime.build_tool_description("minimal-tool-description")
    assert terse_tool["function"]["description"] == runtime.build_tool_description("terse")
    assert default_tool["function"]["parameters"]["required"] == ["command"]
    assert default_tool["function"]["parameters"]["properties"]["command"]["type"] == "string"
