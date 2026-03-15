from __future__ import annotations

import datetime as dt
import difflib
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Callable

from ...types import CommandResult, err
from ...utils import error_message, looks_binary
from ..core import CommandContext
from .io import materialized_limit_error


@dataclass(frozen=True, slots=True)
class ParsedDiffCommand:
    format: str
    context_lines: int
    recursive: bool
    force_text: bool
    ignore_space_change: bool
    ignore_case: bool
    left: str
    right: str


@dataclass(frozen=True, slots=True)
class DiffFile:
    display_name: str
    modified_epoch_ms: int
    load_bytes: Callable[[], bytes | object]


@dataclass(frozen=True, slots=True)
class DiffDirectory:
    display_name: str
    normalized_path: str


def parse_diff_args(args: list[str]) -> tuple[ParsedDiffCommand | None, str | None]:
    format_name = "normal"
    context_lines = 3
    recursive = False
    force_text = False
    ignore_space_change = False
    ignore_case = False
    parsing_options = True
    operands: list[str] = []

    index = 0
    while index < len(args):
        arg = args[index]

        if parsing_options and arg == "--":
            parsing_options = False
            index += 1
            continue

        if parsing_options and arg.startswith("--"):
            parsed, error_text, consume_next = _parse_long_diff_option(arg)
            if error_text is not None:
                return (None, error_text)
            if parsed is not None:
                format_name = parsed.get("format", format_name)
                context_lines = parsed.get("context_lines", context_lines)
                recursive = parsed.get("recursive", recursive)
                force_text = parsed.get("force_text", force_text)
                ignore_space_change = parsed.get("ignore_space_change", ignore_space_change)
                ignore_case = parsed.get("ignore_case", ignore_case)
                if consume_next:
                    index += 1
                index += 1
                continue

        if parsing_options and arg.startswith("-") and arg != "-":
            next_arg = args[index + 1] if index + 1 < len(args) else None
            parsed, error_text, consume_next = _parse_short_diff_option(arg, next_arg)
            if error_text is not None:
                return (None, error_text)
            if parsed is not None:
                format_name = parsed.get("format", format_name)
                context_lines = parsed.get("context_lines", context_lines)
                recursive = parsed.get("recursive", recursive)
                force_text = parsed.get("force_text", force_text)
                ignore_space_change = parsed.get("ignore_space_change", ignore_space_change)
                ignore_case = parsed.get("ignore_case", ignore_case)
                if consume_next:
                    index += 1
                index += 1
                continue

        operands.append(arg)
        parsing_options = False
        index += 1

    if len(operands) != 2:
        return (None, "usage: diff [-u|-U N|-c|-C N] [-r] [-a] [-b] [-i] <left> <right>")

    return (
        ParsedDiffCommand(
            format=format_name,
            context_lines=context_lines,
            recursive=recursive,
            force_text=force_text,
            ignore_space_change=ignore_space_change,
            ignore_case=ignore_case,
            left=operands[0],
            right=operands[1],
        ),
        None,
    )


async def run_diff_command(
    ctx: CommandContext,
    parsed: ParsedDiffCommand,
    stdin: bytes,
) -> CommandResult:
    resolved, error_result = await _resolve_diff_pair(ctx, parsed.left, parsed.right, stdin)
    if error_result is not None:
        return error_result
    assert resolved is not None

    left, right = resolved
    if isinstance(left, DiffDirectory) and isinstance(right, DiffDirectory):
        return await _compare_directories(ctx, left, right, parsed, stdin)

    if not isinstance(left, DiffFile) or not isinstance(right, DiffFile):
        return err("diff: internal error: mismatched diff targets", exit_code=2)

    return await _compare_files(left, right, parsed)


async def _resolve_diff_pair(
    ctx: CommandContext,
    left_arg: str,
    right_arg: str,
    stdin: bytes,
) -> tuple[tuple[DiffFile | DiffDirectory, DiffFile | DiffDirectory] | None, CommandResult | None]:
    left, error_result = await _resolve_diff_target(ctx, left_arg, stdin)
    if error_result is not None:
        return (None, error_result)

    right, error_result = await _resolve_diff_target(ctx, right_arg, stdin)
    if error_result is not None:
        return (None, error_result)

    assert left is not None and right is not None

    if isinstance(left, DiffDirectory) and isinstance(right, DiffFile) and right_arg != "-":
        return await _resolve_dir_file_pair(ctx, left, right_arg, stdin, True)
    if isinstance(left, DiffFile) and isinstance(right, DiffDirectory) and left_arg != "-":
        return await _resolve_dir_file_pair(ctx, right, left_arg, stdin, False)
    if isinstance(left, DiffDirectory) and isinstance(right, DiffDirectory):
        return ((left, right), None)
    if isinstance(left, DiffDirectory) or isinstance(right, DiffDirectory):
        return (None, err("diff: cannot compare a directory against stdin", exit_code=2))
    return ((left, right), None)


async def _resolve_dir_file_pair(
    ctx: CommandContext,
    directory: DiffDirectory,
    file_arg: str,
    stdin: bytes,
    directory_on_left: bool,
) -> tuple[tuple[DiffFile | DiffDirectory, DiffFile | DiffDirectory] | None, CommandResult | None]:
    candidate_path = (
        f"/{PurePosixPath(file_arg).name}"
        if directory.normalized_path == "/"
        else f"{directory.normalized_path}/{PurePosixPath(file_arg).name}"
    )
    candidate, error_result = await _resolve_diff_target(ctx, candidate_path, stdin)
    if error_result is not None:
        return (
            None,
            err(f"diff: {ctx.vfs.normalize(candidate_path)}: No such file or directory", exit_code=2),
        )
    if not isinstance(candidate, DiffFile):
        assert isinstance(candidate, DiffDirectory)
        return (None, err(f"diff: {candidate.display_name}: Is a directory", exit_code=2))

    file_target, error_result = await _resolve_diff_target(ctx, file_arg, stdin)
    if error_result is not None or not isinstance(file_target, DiffFile):
        return (None, err(f"diff: {file_arg}: No such file or directory", exit_code=2))

    if directory_on_left:
        return ((candidate, file_target), None)
    return ((file_target, candidate), None)


async def _resolve_diff_target(
    ctx: CommandContext,
    arg: str,
    stdin: bytes,
) -> tuple[DiffFile | DiffDirectory | None, CommandResult | None]:
    if arg == "-":
        def load_stdin() -> bytes:
            limit_error = materialized_limit_error(ctx, "diff", "stdin", len(stdin))
            if limit_error is not None:
                raise ValueError(limit_error.stderr)
            return bytes(stdin)

        return (DiffFile(display_name="-", modified_epoch_ms=0, load_bytes=load_stdin), None)

    try:
        info = await ctx.vfs.stat(arg)
    except Exception as caught:
        return (None, err(_format_diff_failure_message(caught), exit_code=2))

    if not info.exists:
        return (None, err(f"diff: {ctx.vfs.normalize(arg)}: No such file or directory", exit_code=2))

    if info.is_dir:
        return (
            DiffDirectory(display_name=info.path, normalized_path=info.path),
            None,
        )

    def load_file() -> bytes:
        raise RuntimeError("load_file must be replaced")

    async def read_file() -> bytes:
        limit_error = materialized_limit_error(ctx, "diff", info.path, info.size)
        if limit_error is not None:
            raise ValueError(limit_error.stderr)
        return await ctx.vfs.read_bytes(info.path)

    async_bytes = read_file

    def load_file() -> bytes:
        raise RuntimeError("async file loader invoked synchronously")

    file_target = DiffFile(
        display_name=info.path,
        modified_epoch_ms=info.modified_epoch_ms,
        load_bytes=async_bytes,
    )
    return (file_target, None)


async def _compare_directories(
    ctx: CommandContext,
    left: DiffDirectory,
    right: DiffDirectory,
    parsed: ParsedDiffCommand,
    stdin: bytes,
) -> CommandResult:
    left_entries = await _list_directory_entries(ctx, left.normalized_path)
    right_entries = await _list_directory_entries(ctx, right.normalized_path)
    names = sorted(set(left_entries) | set(right_entries))
    chunks: list[bytes] = []
    exit_code = 0
    prefix = _build_directory_diff_prefix(parsed)

    for name in names:
        left_entry = left_entries.get(name)
        right_entry = right_entries.get(name)
        if left_entry is None:
            exit_code = 1
            chunks.append(f"Only in {right.display_name}: {name}\n".encode("utf-8"))
            continue
        if right_entry is None:
            exit_code = 1
            chunks.append(f"Only in {left.display_name}: {name}\n".encode("utf-8"))
            continue

        left_path = _join_path(left.display_name, name)
        right_path = _join_path(right.display_name, name)

        if left_entry["is_dir"] and right_entry["is_dir"]:
            if parsed.recursive:
                nested = await _compare_directories(
                    ctx,
                    DiffDirectory(left_path, left_entry["path"]),
                    DiffDirectory(right_path, right_entry["path"]),
                    parsed,
                    stdin,
                )
                if nested.exit_code == 2:
                    return nested
                if nested.exit_code == 1:
                    exit_code = 1
                if nested.stdout:
                    chunks.append(nested.stdout)
            else:
                exit_code = 1
                chunks.append(
                    f"Common subdirectories: {left_path} and {right_path}\n".encode("utf-8")
                )
            continue

        if left_entry["is_dir"] != right_entry["is_dir"]:
            exit_code = 1
            left_kind = "directory" if left_entry["is_dir"] else "regular file"
            right_kind = "directory" if right_entry["is_dir"] else "regular file"
            chunks.append(
                (
                    f"File {left_path} is a {left_kind} while file {right_path} "
                    f"is a {right_kind}\n"
                ).encode("utf-8")
            )
            continue

        file_result = await _compare_files(
            _create_directory_diff_file(ctx, left_entry, left_path),
            _create_directory_diff_file(ctx, right_entry, right_path),
            parsed,
            directory_diff_prefix=prefix,
        )
        if file_result.exit_code == 2:
            return file_result
        if file_result.exit_code == 1:
            exit_code = 1
            chunks.append(file_result.stdout)

    return CommandResult(
        stdout=b"".join(chunks),
        stderr="",
        exit_code=exit_code,
        content_type="text/plain",
    )


async def _compare_files(
    left: DiffFile,
    right: DiffFile,
    parsed: ParsedDiffCommand,
    directory_diff_prefix: str | None = None,
) -> CommandResult:
    try:
        left_bytes = await _load_diff_file_bytes(left)
        right_bytes = await _load_diff_file_bytes(right)
    except Exception as caught:
        return err(_format_diff_failure_message(caught), exit_code=2)

    if left_bytes == right_bytes:
        return CommandResult(stdout=b"", stderr="", exit_code=0, content_type="text/plain")

    if not parsed.force_text and (looks_binary(left_bytes) or looks_binary(right_bytes)):
        return CommandResult(
            stdout=f"Binary files {left.display_name} and {right.display_name} differ\n".encode("utf-8"),
            stderr="",
            exit_code=1,
            content_type="text/plain",
        )

    if parsed.format == "normal":
        stdout = _render_normal_diff(left, right, left_bytes, right_bytes, parsed, directory_diff_prefix)
    elif parsed.format == "unified":
        stdout = _render_unified_diff(left, right, left_bytes, right_bytes, parsed, directory_diff_prefix)
    else:
        stdout = _render_context_diff(left, right, left_bytes, right_bytes, parsed, directory_diff_prefix)

    return CommandResult(stdout=stdout, stderr="", exit_code=1, content_type="text/plain")


async def _load_diff_file_bytes(file_target: DiffFile) -> bytes:
    loaded = file_target.load_bytes()
    if hasattr(loaded, "__await__"):
        return await loaded  # type: ignore[return-value]
    return loaded  # type: ignore[return-value]


async def _list_directory_entries(
    ctx: CommandContext,
    dir_path: str,
) -> dict[str, dict[str, int | str | bool]]:
    entries: dict[str, dict[str, int | str | bool]] = {}
    for entry in await ctx.vfs.listdir(dir_path):
        is_dir = entry.endswith("/")
        name = entry[:-1] if is_dir else entry
        child_path = _join_path(dir_path, name)
        info = await ctx.vfs.stat(child_path)
        entries[name] = {
            "is_dir": is_dir,
            "path": info.path,
            "modified_epoch_ms": info.modified_epoch_ms,
            "size": info.size,
        }
    return entries


def _create_directory_diff_file(
    ctx: CommandContext,
    entry: dict[str, int | str | bool],
    display_name: str,
) -> DiffFile:
    async def load_bytes() -> bytes:
        entry_path = str(entry["path"])
        limit_error = materialized_limit_error(ctx, "diff", entry_path, int(entry["size"]))
        if limit_error is not None:
            raise ValueError(limit_error.stderr)
        return await ctx.vfs.read_bytes(entry_path)

    return DiffFile(
        display_name=display_name,
        modified_epoch_ms=int(entry["modified_epoch_ms"]),
        load_bytes=load_bytes,
    )


def _render_normal_diff(
    left: DiffFile,
    right: DiffFile,
    left_bytes: bytes,
    right_bytes: bytes,
    parsed: ParsedDiffCommand,
    directory_diff_prefix: str | None,
) -> bytes:
    left_lines = _decode_diff_lines(left_bytes)
    right_lines = _decode_diff_lines(right_bytes)
    matcher = difflib.SequenceMatcher(
        None,
        [_normalize_diff_line(line, parsed) for line in left_lines],
        [_normalize_diff_line(line, parsed) for line in right_lines],
        autojunk=False,
    )
    chunks: list[str] = []
    if directory_diff_prefix is not None:
        chunks.append(f"{directory_diff_prefix} {left.display_name} {right.display_name}\n")

    for tag, i1, i2, j1, j2 in matcher.get_opcodes():
        if tag == "equal":
            continue
        if tag == "replace":
            chunks.append(
                f"{_format_normal_range(i1 + 1, i2 - i1)}c{_format_normal_range(j1 + 1, j2 - j1)}\n"
            )
            chunks.extend(f"< {line}\n" for line in left_lines[i1:i2])
            chunks.append("---\n")
            chunks.extend(f"> {line}\n" for line in right_lines[j1:j2])
            continue
        if tag == "delete":
            chunks.append(f"{_format_normal_range(i1 + 1, i2 - i1)}d{j1}\n")
            chunks.extend(f"< {line}\n" for line in left_lines[i1:i2])
            continue
        if tag == "insert":
            chunks.append(f"{i1}a{_format_normal_range(j1 + 1, j2 - j1)}\n")
            chunks.extend(f"> {line}\n" for line in right_lines[j1:j2])

    return "".join(chunks).encode("utf-8")


def _render_unified_diff(
    left: DiffFile,
    right: DiffFile,
    left_bytes: bytes,
    right_bytes: bytes,
    parsed: ParsedDiffCommand,
    directory_diff_prefix: str | None,
) -> bytes:
    left_lines = _decode_diff_lines(left_bytes)
    right_lines = _decode_diff_lines(right_bytes)
    chunks: list[str] = []
    if directory_diff_prefix is not None:
        chunks.append(f"{directory_diff_prefix} {left.display_name} {right.display_name}\n")

    chunks.extend(
        difflib.unified_diff(
            left_lines,
            right_lines,
            fromfile=left.display_name,
            tofile=right.display_name,
            fromfiledate=_format_unified_timestamp(left.modified_epoch_ms),
            tofiledate=_format_unified_timestamp(right.modified_epoch_ms),
            n=parsed.context_lines,
            lineterm="",
        )
    )
    return "\n".join(chunks).encode("utf-8") + b"\n"


def _render_context_diff(
    left: DiffFile,
    right: DiffFile,
    left_bytes: bytes,
    right_bytes: bytes,
    parsed: ParsedDiffCommand,
    directory_diff_prefix: str | None,
) -> bytes:
    left_lines = _decode_diff_lines(left_bytes)
    right_lines = _decode_diff_lines(right_bytes)
    chunks: list[str] = []
    if directory_diff_prefix is not None:
        chunks.append(f"{directory_diff_prefix} {left.display_name} {right.display_name}\n")

    chunks.extend(
        difflib.context_diff(
            left_lines,
            right_lines,
            fromfile=left.display_name,
            tofile=right.display_name,
            fromfiledate=_format_context_timestamp(left.modified_epoch_ms),
            tofiledate=_format_context_timestamp(right.modified_epoch_ms),
            n=parsed.context_lines,
            lineterm="",
        )
    )
    return "\n".join(chunks).encode("utf-8") + b"\n"


def _decode_diff_lines(data: bytes) -> list[str]:
    if not data:
        return []
    text = data.decode("latin1").replace("\r\n", "\n").replace("\r", "\n")
    if text.endswith("\n"):
        text = text[:-1]
    if text == "":
        return []
    return text.split("\n")


def _normalize_diff_line(line: str, parsed: ParsedDiffCommand) -> str:
    normalized = line
    if parsed.ignore_space_change:
        normalized = " ".join(normalized.replace("\t", " ").split())
    if parsed.ignore_case:
        normalized = normalized.lower()
    return normalized


def _parse_long_diff_option(
    arg: str,
) -> tuple[dict[str, int | bool | str] | None, str | None, bool]:
    if arg == "--recursive":
        return ({"recursive": True}, None, False)
    if arg == "--text":
        return ({"force_text": True}, None, False)
    if arg == "--ignore-space-change":
        return ({"ignore_space_change": True}, None, False)
    if arg == "--ignore-case":
        return ({"ignore_case": True}, None, False)
    if arg == "--unified":
        return ({"format": "unified", "context_lines": 3}, None, False)
    if arg.startswith("--unified="):
        count, error_text = _parse_context_count(arg[len("--unified=") :])
        if error_text is not None:
            return (None, error_text, False)
        return ({"format": "unified", "context_lines": count}, None, False)
    if arg == "--context":
        return ({"format": "context", "context_lines": 3}, None, False)
    if arg.startswith("--context="):
        count, error_text = _parse_context_count(arg[len("--context=") :])
        if error_text is not None:
            return (None, error_text, False)
        return ({"format": "context", "context_lines": count}, None, False)
    return (None, f"unknown option: {arg}", False)


def _parse_short_diff_option(
    arg: str,
    next_arg: str | None,
) -> tuple[dict[str, int | bool | str] | None, str | None, bool]:
    if arg == "-u":
        return ({"format": "unified", "context_lines": 3}, None, False)
    if arg == "-c":
        return ({"format": "context", "context_lines": 3}, None, False)
    if arg == "-r":
        return ({"recursive": True}, None, False)
    if arg == "-a":
        return ({"force_text": True}, None, False)
    if arg == "-b":
        return ({"ignore_space_change": True}, None, False)
    if arg == "-i":
        return ({"ignore_case": True}, None, False)
    if arg in {"-U", "-C"}:
        if next_arg is None:
            return (None, f"missing value for {arg}", False)
        count, error_text = _parse_context_count(next_arg)
        if error_text is not None:
            return (None, error_text, False)
        return (
            {
                "format": "unified" if arg == "-U" else "context",
                "context_lines": count,
            },
            None,
            True,
        )
    if len(arg) > 2 and arg[:2] in {"-U", "-C"} and arg[2:].isdigit():
        count, error_text = _parse_context_count(arg[2:])
        if error_text is not None:
            return (None, error_text, False)
        return (
            {
                "format": "unified" if arg[1] == "U" else "context",
                "context_lines": count,
            },
            None,
            False,
        )
    return (None, f"unknown option: {arg}", False)


def _parse_context_count(value: str) -> tuple[int, str | None]:
    try:
        parsed = int(value, 10)
    except ValueError:
        return (0, f"invalid context line count: {value}")
    if parsed < 0:
        return (0, f"invalid context line count: {value}")
    return (parsed, None)


def _build_directory_diff_prefix(parsed: ParsedDiffCommand) -> str:
    parts = ["diff"]
    if parsed.recursive:
        parts.append("-r")
    if parsed.force_text:
        parts.append("-a")
    if parsed.ignore_space_change:
        parts.append("-b")
    if parsed.ignore_case:
        parts.append("-i")
    if parsed.format == "unified":
        parts.append("-u" if parsed.context_lines == 3 else f"-U {parsed.context_lines}")
    if parsed.format == "context":
        parts.append("-c" if parsed.context_lines == 3 else f"-C {parsed.context_lines}")
    return " ".join(parts)


def _format_normal_range(start: int, count: int) -> str:
    if count <= 1:
        return str(start)
    return f"{start},{start + count - 1}"


def _format_unified_timestamp(epoch_ms: int) -> str:
    date = dt.datetime.fromtimestamp(epoch_ms / 1000)
    offset = date.astimezone().strftime("%z")
    return f"{date.strftime('%Y-%m-%d %H:%M:%S')}.{date.microsecond // 1000:03d} {offset}"


def _format_context_timestamp(epoch_ms: int) -> str:
    date = dt.datetime.fromtimestamp(epoch_ms / 1000)
    return date.strftime("%a %b %d %H:%M:%S %Y")


def _join_path(base_path: str, name: str) -> str:
    if base_path == "/":
        return f"/{name}"
    return f"{base_path}/{name}"


def _format_diff_failure_message(caught: object) -> str:
    message = error_message(caught)
    if message.startswith("diff: "):
        return message
    return f"diff: {message}"
