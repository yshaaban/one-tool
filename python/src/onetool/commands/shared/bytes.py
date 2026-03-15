from __future__ import annotations

from dataclasses import dataclass

from ...types import CommandResult, err
from ...utils import parent_path
from ..core import CommandContext
from .io import materialized_limit_error


@dataclass(frozen=True, slots=True)
class BytesInputResult:
    data: bytes | None = None
    source: str | None = None
    error: CommandResult | None = None


async def read_bytes_from_file_or_stdin(
    ctx: CommandContext,
    file_path: str | None,
    stdin: bytes,
    command_name: str,
) -> BytesInputResult:
    if file_path is not None:
        info = await ctx.vfs.stat(file_path)
        normalized = ctx.vfs.normalize(file_path)
        if not info.exists:
            return BytesInputResult(
                error=err(
                    f"{command_name}: file not found: {normalized}. "
                    f"Use: ls / or ls {parent_path(file_path)}"
                )
            )
        if info.is_dir:
            return BytesInputResult(
                error=err(f"{command_name}: path is a directory: {normalized}. Use: ls {normalized}")
            )

        limit_error = materialized_limit_error(ctx, command_name, normalized, info.size)
        if limit_error is not None:
            return BytesInputResult(error=limit_error)

        return BytesInputResult(data=await ctx.vfs.read_bytes(file_path), source=normalized)

    if stdin:
        limit_error = materialized_limit_error(ctx, command_name, "stdin", len(stdin))
        if limit_error is not None:
            return BytesInputResult(error=limit_error)
        return BytesInputResult(data=bytes(stdin), source="stdin")

    return BytesInputResult(error=err(f"{command_name}: no input provided. Usage: see 'help {command_name}'"))
