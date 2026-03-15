from __future__ import annotations

from dataclasses import dataclass

from ...execution_policy import check_materialized_byte_limit, format_materialized_limit_message
from ...types import CommandResult, err
from ...utils import format_size, looks_binary, parent_path
from ..core import CommandContext, CommandSpec


@dataclass(frozen=True, slots=True)
class TextInputResult:
    text: str | None = None
    error: CommandResult | None = None


def render_help(spec: CommandSpec) -> str:
    return f"{spec.name}: {spec.summary}\nUsage: {spec.usage}\n\n{spec.details}"


async def read_text_from_file_or_stdin(
    ctx: CommandContext,
    file_path: str | None,
    stdin: bytes,
    command_name: str,
) -> TextInputResult:
    if file_path is not None:
        info = await ctx.vfs.stat(file_path)
        normalized = ctx.vfs.normalize(file_path)
        if not info.exists:
            return TextInputResult(
                error=err(
                    f"{command_name}: file not found: {normalized}. "
                    f"Use: ls / or ls {parent_path(file_path)}"
                )
            )
        if info.is_dir:
            return TextInputResult(
                error=err(f"{command_name}: path is a directory: {normalized}. Use: ls {normalized}")
            )

        limit_error = materialized_limit_error(ctx, command_name, normalized, info.size)
        if limit_error is not None:
            return TextInputResult(error=limit_error)

        raw = await ctx.vfs.read_bytes(file_path)
        if looks_binary(raw):
            return TextInputResult(
                error=err(
                    f"{command_name}: binary file ({format_size(len(raw))}): {normalized}. "
                    f"Use: stat {normalized}"
                )
            )
        return TextInputResult(text=raw.decode("utf-8"))

    if stdin:
        limit_error = materialized_limit_error(ctx, command_name, "stdin", len(stdin))
        if limit_error is not None:
            return TextInputResult(error=limit_error)

        if looks_binary(stdin):
            return TextInputResult(
                error=err(
                    f"{command_name}: stdin is binary ({format_size(len(stdin))}). "
                    "Pipe text only, or save binary data to a file and inspect with stat."
                )
            )
        return TextInputResult(text=stdin.decode("utf-8"))

    return TextInputResult(error=err(f"{command_name}: no input provided. Usage: see 'help {command_name}'"))


def content_from_args_or_stdin(
    args: list[str],
    stdin: bytes,
    command_name: str,
) -> tuple[bytes | None, CommandResult | None]:
    if len(args) > 1:
        return (" ".join(args[1:]).encode("utf-8"), None)
    if stdin:
        return (bytes(stdin), None)
    return (
        None,
        err(f"{command_name}: no content provided. Pass content inline or pipe it via stdin."),
    )


def parse_n_flag(args: list[str], default_value: int) -> tuple[int, list[str], CommandResult | None]:
    if not args:
        return (default_value, [], None)
    if args[0] != "-n":
        return (default_value, args, None)
    if len(args) < 2:
        return (default_value, args, err("missing value for -n"))

    try:
        parsed = int(args[1], 10)
    except ValueError:
        return (default_value, args, err(f"invalid integer for -n: {args[1]}"))
    return (parsed, args[2:], None)


def materialized_limit_error(
    ctx: CommandContext,
    command_name: str,
    subject: str,
    actual_bytes: int,
) -> CommandResult | None:
    exceeded = check_materialized_byte_limit(ctx.execution_policy, actual_bytes)
    if exceeded is None:
        return None
    return err(format_materialized_limit_message(command_name, subject, exceeded.actual, exceeded.limit))
