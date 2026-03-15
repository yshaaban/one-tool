from __future__ import annotations

from ..core import CommandContext
from ...utils import parent_path
from ...vfs.errors import VfsErrorCode, to_vfs_error


def error_code(caught: object) -> VfsErrorCode | None:
    resolved = to_vfs_error(caught)
    if resolved is None:
        return None
    return resolved.code


def error_code_raw(caught: object) -> str | None:
    resolved = error_code(caught)
    if resolved is not None:
        return resolved

    code = getattr(caught, "code", None)
    if isinstance(code, str):
        return code
    return None


def error_path(caught: object) -> str:
    resolved = to_vfs_error(caught)
    if resolved is None:
        return ""
    return resolved.path


def error_target_path(caught: object) -> str | None:
    resolved = to_vfs_error(caught)
    if resolved is None:
        return None
    return resolved.target_path


async def first_file_in_path(ctx: CommandContext, input_path: str) -> str | None:
    normalized = ctx.vfs.normalize(input_path)
    if normalized == "/":
        return None

    current = ""
    for segment in filter(None, normalized.split("/")):
        current = f"{current}/{segment}"
        info = await ctx.vfs.stat(current)
        if info.exists and not info.is_dir:
            return current

    return None


async def blocking_parent_path(ctx: CommandContext, input_path: str) -> str:
    return (await first_file_in_path(ctx, parent_path(input_path))) or parent_path(input_path)
