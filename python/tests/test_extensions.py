from __future__ import annotations

import pytest

from onetool.commands.core import CommandContext, CommandRegistry
from onetool.commands.groups.system import help_command
from onetool.execution_policy import resolve_execution_policy
from onetool.extensions import (
    FormatVfsErrorOptions,
    collect_commands,
    define_command_group,
    format_vfs_error,
    parse_count_flag,
    read_bytes_input,
    read_json_input,
    read_text_input,
)
from onetool.memory import SimpleMemory
from onetool.testing.adapters import DemoFetch
from onetool.types import ToolAdapters, ok
from onetool.vfs.errors import vfs_error
from onetool.vfs.memory_vfs import MemoryVFS


def _context() -> CommandContext:
    return CommandContext(
        vfs=MemoryVFS(),
        adapters=ToolAdapters(fetch=DemoFetch({"res:1": {"hello": "world"}})),
        memory=SimpleMemory(),
        registry=CommandRegistry(),
        execution_policy=resolve_execution_policy(),
        output_dir="/.system/cmd-output",
        output_counter=0,
    )


@pytest.mark.asyncio
async def test_format_vfs_error_handles_common_cases() -> None:
    ctx = _context()
    await ctx.vfs.write_bytes("/blocked", b"data")

    not_found = await format_vfs_error(
        ctx,
        "cat",
        "/missing.txt",
        vfs_error("ENOENT", "/missing.txt"),
        FormatVfsErrorOptions(not_found_label="file not found"),
    )
    parent_not_dir = await format_vfs_error(
        ctx,
        "write",
        "/blocked/child.txt",
        vfs_error("ENOTDIR", "/blocked"),
    )

    assert not_found.stderr == "cat: file not found: /missing.txt. Use: ls /"
    assert parent_not_dir.stderr == "write: parent is not a directory: /blocked"


@pytest.mark.asyncio
async def test_input_helpers_read_from_files_and_stdin() -> None:
    ctx = _context()
    await ctx.vfs.write_bytes("/data.json", b'{ "hello": "world" }')

    text = await read_text_input(ctx, "cat", "/data.json", b"")
    payload = await read_bytes_input(ctx, "cat", None, b"stdin bytes")
    value = await read_json_input(ctx, "json get", "/data.json", b"")

    assert text.ok is True and text.value == '{ "hello": "world" }'
    assert payload.ok is True and payload.value == b"stdin bytes"
    assert value.ok is True and value.value == {"hello": "world"}


@pytest.mark.asyncio
async def test_read_json_input_matches_typescript_invalid_json_message() -> None:
    ctx = _context()

    invalid = await read_json_input(ctx, "json pretty", None, b"{ bad json")

    assert invalid.ok is False and invalid.error is not None
    assert invalid.error.stderr == (
        "json pretty: invalid JSON: Expected property name or '}' in JSON at position 2 (line 1 column 3)"
    )


def test_parse_count_flag_and_group_helpers() -> None:
    parsed = parse_count_flag("tail", ["-n", "5", "/tmp/file"], 10)
    invalid = parse_count_flag("tail", ["-n", "oops"], 10)

    echo = define_command_group(
        "misc",
        [
            help_command.__class__(
                name="echo",
                summary="Echo text.",
                usage="echo <text...>",
                details="Examples:\n  echo hello",
                handler=lambda _ctx, args, _stdin: ok(" ".join(args)),
            )
        ],
    )

    assert parsed.ok is True and parsed.value is not None and parsed.value.count == 5
    assert parsed.value.rest == ["/tmp/file"]
    assert invalid.ok is False and invalid.error is not None
    assert collect_commands([echo])[0].name == "echo"
