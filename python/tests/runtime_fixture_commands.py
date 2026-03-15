from __future__ import annotations

from collections.abc import Sequence

from onetool.commands import CommandSpec
from onetool.types import err, ok, ok_bytes


def runtime_fixture_commands(ids: Sequence[str]) -> tuple[CommandSpec, ...]:
    fixtures: list[CommandSpec] = []

    for command_id in ids:
        fixtures.append(_runtime_fixture_command(command_id))

    return tuple(fixtures)


def _runtime_fixture_command(command_id: str) -> CommandSpec:
    match command_id:
        case "echo":
            return CommandSpec(
                name="echo",
                summary="Echo text.",
                usage="echo <text...>",
                details="Examples:\n  echo hello",
                handler=lambda _ctx, args, _stdin: ok(" ".join(args)),
            )
        case "fail":
            return CommandSpec(
                name="fail",
                summary="Fail immediately.",
                usage="fail",
                details="Examples:\n  fail",
                handler=lambda _ctx, _args, _stdin: err("fail: forced failure"),
            )
        case "burst":
            return CommandSpec(
                name="burst",
                summary="Emit three lines.",
                usage="burst",
                details="Examples:\n  burst",
                handler=lambda _ctx, _args, _stdin: ok("first line\nsecond line\nthird line"),
            )
        case "binary":
            return CommandSpec(
                name="binary",
                summary="Emit binary bytes.",
                usage="binary",
                details="Examples:\n  binary",
                handler=lambda _ctx, _args, _stdin: ok_bytes(bytes([0, 1, 2, 3]), "application/octet-stream"),
            )
        case "longline":
            return CommandSpec(
                name="longline",
                summary="Emit one long line.",
                usage="longline",
                details="Examples:\n  longline",
                handler=lambda _ctx, _args, _stdin: ok("abcdefghijklmnopqrstuvwxyz"),
            )
        case "help-override":
            return CommandSpec(
                name="help",
                summary="Overridden help.",
                usage="help",
                details="Examples:\n  help",
                handler=lambda _ctx, _args, _stdin: ok("override help"),
            )
        case _:
            raise AssertionError(f"unsupported runtime fixture command: {command_id}")
