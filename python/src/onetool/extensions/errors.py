from __future__ import annotations

from dataclasses import dataclass

from ..commands.core import CommandContext
from ..commands.shared.errors import blocking_parent_path, error_code
from ..types import CommandResult, err
from ..utils import error_message, parent_path
from ..vfs.errors import format_escape_path_error_message, format_resource_limit_error_message


@dataclass(frozen=True, slots=True)
class FormatVfsErrorOptions:
    not_found_label: str | None = None
    directory_label: str | None = None
    not_found_hint: str | None = None
    directory_hint: str | None = None


def usage_error(command_name: str, usage: str) -> CommandResult:
    return err(f"{command_name}: usage: {usage}")


def stdin_not_accepted_error(command_name: str) -> CommandResult:
    return err(f"{command_name}: does not accept stdin")


def missing_adapter_error(command_name: str, adapter_name: str) -> CommandResult:
    return err(f"{command_name}: no {adapter_name} adapter configured")


async def format_vfs_error(
    ctx: CommandContext,
    command_name: str,
    input_path: str,
    caught: object,
    options: FormatVfsErrorOptions | None = None,
) -> CommandResult:
    resolved = options or FormatVfsErrorOptions()
    normalized_path = ctx.vfs.normalize(input_path)
    code = error_code(caught)

    if code == "ENOENT":
        hint = resolved.not_found_hint or f"ls {parent_path(normalized_path)}"
        return err(
            f"{command_name}: {resolved.not_found_label or 'path not found'}: "
            f"{normalized_path}{_format_hint(hint)}"
        )

    if code == "EISDIR":
        hint = resolved.directory_hint or f"ls {normalized_path}"
        return err(
            f"{command_name}: {resolved.directory_label or 'path is a directory'}: "
            f"{normalized_path}{_format_hint(hint)}"
        )

    if code == "ENOTDIR":
        blocked_parent = await blocking_parent_path(ctx, normalized_path)
        return err(f"{command_name}: parent is not a directory: {blocked_parent}")

    if code == "EESCAPE":
        return err(
            format_escape_path_error_message(command_name, caught, normalized_path)
            or f"{command_name}: path escapes workspace root: {normalized_path}"
        )

    if code == "EEXIST":
        return err(f"{command_name}: path already exists: {normalized_path}")

    if code == "ERESOURCE_LIMIT":
        return err(
            format_resource_limit_error_message(command_name, caught)
            or f"{command_name}: resource limit exceeded (resource limit) at {normalized_path}"
        )

    return err(f"{command_name}: {error_message(caught)}")


def _format_hint(hint: str | None) -> str:
    if not hint:
        return ""
    return f". Use: {hint}"
