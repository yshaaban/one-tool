from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Literal

VfsErrorCode = Literal[
    "ENOENT",
    "EISDIR",
    "ENOTDIR",
    "EEXIST",
    "EINVAL",
    "EROOT",
    "EESCAPE",
    "ERESOURCE_LIMIT",
]


@dataclass(frozen=True, slots=True)
class VfsErrorOptions:
    path: str
    target_path: str | None = None
    details: dict[str, Any] | None = None
    cause: object | None = None
    message: str | None = None


class VfsError(Exception):
    def __init__(self, code: VfsErrorCode, options: VfsErrorOptions) -> None:
        message = options.message or f"{code}:{options.path}"
        super().__init__(message)
        self.code = code
        self.path = options.path
        self.target_path = options.target_path
        self.details = options.details
        self.cause = options.cause


def is_vfs_error(value: object) -> bool:
    return isinstance(value, VfsError)


def to_vfs_error(value: object) -> VfsError | None:
    if isinstance(value, VfsError):
        return value

    code = getattr(value, "code", None)
    path = getattr(value, "path", None)
    if code in _VFS_ERROR_CODES and isinstance(path, str):
        target_path = getattr(value, "target_path", getattr(value, "targetPath", None))
        details = getattr(value, "details", None)
        message = getattr(value, "message", None)
        return VfsError(
            code,  # type: ignore[arg-type]
            VfsErrorOptions(
                path=path,
                target_path=target_path if isinstance(target_path, str) else None,
                details=details if isinstance(details, dict) else None,
                cause=getattr(value, "cause", None),
                message=message if isinstance(message, str) else None,
            ),
        )

    if isinstance(value, BaseException):
        message = str(value)
        if message == "cannot delete root":
            return VfsError("EROOT", VfsErrorOptions(path="/", cause=value))
        if message.startswith("path escapes root: "):
            escaped = message[len("path escapes root: ") :]
            return VfsError("EESCAPE", VfsErrorOptions(path=escaped, cause=value))

        separator = message.find(":")
        if separator != -1:
            raw_code = message[:separator]
            if raw_code in _VFS_ERROR_CODES:
                path = message[separator + 1 :] or "/"
                return VfsError(
                    raw_code,  # type: ignore[arg-type]
                    VfsErrorOptions(path=path, cause=value, message=message),
                )

    return None


def vfs_error(
    code: VfsErrorCode,
    path: str,
    *,
    target_path: str | None = None,
    details: dict[str, Any] | None = None,
    cause: object | None = None,
    message: str | None = None,
) -> VfsError:
    return VfsError(
        code,
        VfsErrorOptions(
            path=path,
            target_path=target_path,
            details=details,
            cause=cause,
            message=message,
        ),
    )


def format_resource_limit_error_message(command_name: str, caught: object) -> str | None:
    caught_error = to_vfs_error(caught)
    if caught_error is None or caught_error.code != "ERESOURCE_LIMIT":
        return None

    limit_kind = caught_error.details.get("limitKind") if caught_error.details else None
    if not isinstance(limit_kind, str):
        limit_kind = "resource limit"
    limit = caught_error.details.get("limit") if caught_error.details else None
    actual = caught_error.details.get("actual") if caught_error.details else None

    if isinstance(limit, int) and isinstance(actual, int):
        return f"{command_name}: resource limit exceeded ({limit_kind}: {actual} > {limit}) at {caught_error.path}"
    return f"{command_name}: resource limit exceeded ({limit_kind}) at {caught_error.path}"


def format_escape_path_error_message(command_name: str, caught: object, fallback_path: str) -> str | None:
    caught_error = to_vfs_error(caught)
    if caught_error is None or caught_error.code != "EESCAPE":
        return None
    path = caught_error.path or fallback_path
    return f"{command_name}: path escapes workspace root: {path}"


_VFS_ERROR_CODES: set[str] = {
    "ENOENT",
    "EISDIR",
    "ENOTDIR",
    "EEXIST",
    "EINVAL",
    "EROOT",
    "EESCAPE",
    "ERESOURCE_LIMIT",
}
