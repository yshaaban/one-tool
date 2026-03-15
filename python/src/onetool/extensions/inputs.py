from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import TypeVar, cast

from ..commands.core import CommandContext
from ..commands.shared.io import materialized_limit_error, read_text_from_file_or_stdin
from ..commands.shared.json import load_json
from ..types import err
from ..utils import error_message
from ..vfs.errors import vfs_error
from .errors import FormatVfsErrorOptions, format_vfs_error
from .types import HelperResult, helper_failure, helper_success

T = TypeVar("T")


async def read_text_input(
    ctx: CommandContext,
    command_name: str,
    file_path: str | None,
    stdin: bytes,
) -> HelperResult[str]:
    return await _load_input(
        ctx,
        command_name,
        file_path,
        lambda: _read_text_input_inner(ctx, command_name, file_path, stdin),
    )


async def read_bytes_input(
    ctx: CommandContext,
    command_name: str,
    file_path: str | None,
    stdin: bytes,
) -> HelperResult[bytes]:
    if file_path is not None:
        return await _load_input(
            ctx,
            command_name,
            file_path,
            lambda: _read_file_bytes(ctx, command_name, file_path),
        )

    if stdin:
        limit_error = materialized_limit_error(ctx, command_name, "stdin", len(stdin))
        if limit_error is not None:
            return helper_failure(limit_error)
        return helper_success(bytes(stdin))

    return helper_failure(err(f"{command_name}: no input provided. Usage: see 'help {command_name}'"))


async def read_json_input(
    ctx: CommandContext,
    command_name: str,
    file_path: str | None,
    stdin: bytes,
) -> HelperResult[T]:
    return await _load_input(
        ctx,
        command_name,
        file_path,
        lambda: _read_json_input_inner(ctx, command_name, file_path, stdin),
    )


async def _read_text_input_inner(
    ctx: CommandContext,
    command_name: str,
    file_path: str | None,
    stdin: bytes,
) -> HelperResult[str]:
    loaded = await read_text_from_file_or_stdin(ctx, file_path, stdin, command_name)
    if loaded.error is not None:
        return helper_failure(loaded.error)
    return helper_success(loaded.text or "")


async def _read_file_bytes(
    ctx: CommandContext,
    command_name: str,
    file_path: str,
) -> HelperResult[bytes]:
    info = await ctx.vfs.stat(file_path)
    normalized_path = ctx.vfs.normalize(file_path)

    if not info.exists:
        return helper_failure(
            await format_vfs_error(
                ctx,
                command_name,
                file_path,
                vfs_error("ENOENT", normalized_path),
                FormatVfsErrorOptions(not_found_label="file not found"),
            )
        )

    if info.is_dir:
        return helper_failure(
            await format_vfs_error(
                ctx,
                command_name,
                file_path,
                vfs_error("EISDIR", normalized_path),
            )
        )

    limit_error = materialized_limit_error(ctx, command_name, normalized_path, info.size)
    if limit_error is not None:
        return helper_failure(limit_error)

    return helper_success(await ctx.vfs.read_bytes(file_path))


async def _read_json_input_inner(
    ctx: CommandContext,
    command_name: str,
    file_path: str | None,
    stdin: bytes,
) -> HelperResult[T]:
    loaded = await load_json(ctx, file_path, stdin, command_name)
    if loaded.error is not None:
        return helper_failure(loaded.error)
    return helper_success(cast(T, loaded.value))


async def _load_input(
    ctx: CommandContext,
    command_name: str,
    file_path: str | None,
    loader: Callable[[], Awaitable[HelperResult[T]]],
) -> HelperResult[T]:
    try:
        return await loader()
    except Exception as caught:
        return await _handle_input_failure(ctx, command_name, file_path, caught)


async def _handle_input_failure(
    ctx: CommandContext,
    command_name: str,
    file_path: str | None,
    caught: object,
) -> HelperResult[T]:
    if file_path is not None:
        return helper_failure(
            await format_vfs_error(
                ctx,
                command_name,
                file_path,
                caught,
                FormatVfsErrorOptions(not_found_label="file not found"),
            )
        )

    return helper_failure(err(f"{command_name}: {error_message(caught)}"))
