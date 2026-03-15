from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass

from ...types import CommandResult, err, ok, ok_bytes
from ...utils import error_message, format_size, looks_binary, parent_path
from ...vfs.errors import format_escape_path_error_message, format_resource_limit_error_message
from ...vfs.interface import VFileInfo
from ...vfs.path_utils import base_name
from ..core import CommandContext, CommandSpec
from ..shared.diff import parse_diff_args, run_diff_command
from ..shared.errors import blocking_parent_path, error_code, error_path, first_file_in_path
from ..shared.io import content_from_args_or_stdin, materialized_limit_error

LS_USAGE = "ls [-1aRl] [path]"
CAT_USAGE = "cat [path ...|-]"
MKDIR_USAGE = "mkdir [-p] <path>"
RM_USAGE = "rm [-r|-R] <path>"
FIND_USAGE = (
    "find [path] [--type file|dir|-type f|-type d] [--name pattern|-name pattern] "
    "[--max-depth N|-maxdepth N]"
)


@dataclass(frozen=True, slots=True)
class _LsOptions:
    all: bool
    long: bool
    recursive: bool
    target_path: str


@dataclass(frozen=True, slots=True)
class _LsEntry:
    display_name: str
    info: VFileInfo
    is_synthetic: bool = False


@dataclass(frozen=True, slots=True)
class _FindFilters:
    max_depth: int
    type_filter: str | None
    name_pattern: re.Pattern[str] | None


def _concat_byte_chunks(chunks: list[bytes]) -> bytes:
    return b"".join(chunks)


def _parse_single_path_args(
    command_name: str,
    args: list[str],
    usage: str,
    compatibility_flags: tuple[str, ...] = (),
) -> tuple[str | None, str | None]:
    if len(args) == 1:
        return (args[0], None)
    if len(args) == 2 and args[0] in compatibility_flags:
        return (args[1], None)
    if args and args[0].startswith("-") and args[0] not in compatibility_flags:
        return (None, f"{command_name}: unknown option: {args[0]}. Usage: {usage}")
    return (None, f"{command_name}: usage: {usage}")


def _read_cat_stdin(
    ctx: CommandContext,
    stdin: bytes,
    total_bytes: int,
) -> tuple[int | None, CommandResult | None]:
    next_total_bytes = total_bytes + len(stdin)
    limit_error = materialized_limit_error(ctx, "cat", "stdin", next_total_bytes)
    if limit_error is not None:
        return (None, limit_error)
    if looks_binary(stdin):
        return (
            None,
            err(
                f"cat: stdin is binary ({format_size(len(stdin))}). "
                "Pipe text only, or save binary data to a file and inspect with stat."
            ),
        )
    return (next_total_bytes, None)


def _resource_limit_message(command_name: str, caught: object) -> str | None:
    return format_resource_limit_error_message(command_name, caught)


def _escape_path_message(command_name: str, caught: object, fallback_path: str) -> str:
    return (
        format_escape_path_error_message(command_name, caught, fallback_path)
        or f"{command_name}: path escapes workspace root: {fallback_path}"
    )


def _escape_path_result(
    command_name: str,
    caught: object,
    fallback_path: str,
) -> CommandResult | None:
    if error_code(caught) != "EESCAPE":
        return None
    return err(_escape_path_message(command_name, caught, fallback_path))


async def cmd_ls(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    if stdin:
        return err("ls: does not accept stdin")

    options, error_text = _parse_ls_args(args)
    if error_text is not None:
        return err(error_text)
    assert options is not None

    target = options.target_path
    try:
        info = await ctx.vfs.stat(target)
        if not info.exists:
            return err(f"ls: path not found: {ctx.vfs.normalize(target)}")
        if not info.is_dir:
            return ok(_render_ls_output([_create_ls_entry(info.path, info)], options))
        if options.recursive:
            sections = await _collect_ls_sections(ctx, info.path, options)
            return ok(_render_recursive_ls_output(sections, options))
        entries = await _list_ls_entries(ctx, info.path, options)
        return ok(_render_ls_output(entries, options))
    except Exception as caught:
        code = error_code(caught)
        if code == "ENOENT":
            return err(f"ls: path not found: {ctx.vfs.normalize(target)}")
        if code == "EESCAPE":
            return err(_escape_path_message("ls", caught, ctx.vfs.normalize(target)))
        if code == "ENOTDIR":
            normalized = ctx.vfs.normalize(target)
            return err(f"ls: not a directory: {normalized}. Use: stat {normalized}")
        return err(f"ls: {error_message(caught)}")


ls = CommandSpec(
    name="ls",
    summary="List files or directories in the rooted virtual file system.",
    usage=LS_USAGE,
    details="Examples:\n  ls\n  ls -a /\n  ls -R /logs\n  ls -l notes",
    handler=cmd_ls,
    accepts_stdin=False,
    min_args=0,
    conformance_args=("/",),
)


async def cmd_stat(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    if stdin:
        return err("stat: does not accept stdin")
    if len(args) != 1:
        return err("stat: usage: stat <path>")

    try:
        info = await ctx.vfs.stat(args[0])
        if not info.exists:
            return err(f"stat: path not found: {ctx.vfs.normalize(args[0])}")
        lines = [
            f"path: {info.path}",
            f"type: {'directory' if info.is_dir else 'file'}",
            f"size: {info.size} bytes",
            f"media_type: {info.media_type}",
            f"modified_epoch_ms: {info.modified_epoch_ms}",
        ]
        return ok("\n".join(lines))
    except Exception as caught:
        escape_result = _escape_path_result("stat", caught, ctx.vfs.normalize(args[0]))
        if escape_result is not None:
            return escape_result
        return err(f"stat: {error_message(caught)}")


stat = CommandSpec(
    name="stat",
    summary="Show one-tool file metadata such as size, type, and modified time.",
    usage="stat <path>",
    details=(
        "Returns one-tool metadata fields for the rooted workspace. "
        "It does not aim for POSIX stat output parity.\n"
        "Examples:\n"
        "  stat /logs/app.log\n"
        "  stat notes/todo.txt"
    ),
    handler=cmd_stat,
    accepts_stdin=False,
    min_args=1,
    max_args=1,
    conformance_args=("/missing",),
)


async def cmd_cat(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    if not args:
        if not stdin:
            return err(f"cat: usage: {CAT_USAGE}")
        _next_total_bytes, limit_error = _read_cat_stdin(ctx, stdin, 0)
        if limit_error is not None:
            return limit_error
        return ok_bytes(stdin, "text/plain")

    if stdin and "-" not in args:
        return err(
            "cat: stdin is only read when no file paths are given or when '-' is present. "
            f"Usage: {CAT_USAGE}"
        )

    chunks: list[bytes] = []
    total_bytes = 0
    for target in args:
        if target == "-":
            next_total_bytes, limit_error = _read_cat_stdin(ctx, stdin, total_bytes)
            if limit_error is not None:
                return limit_error
            assert next_total_bytes is not None
            total_bytes = next_total_bytes
            chunks.append(stdin)
            continue

        normalized = ctx.vfs.normalize(target)
        try:
            info = await ctx.vfs.stat(target)
            if not info.exists:
                return err(f"cat: file not found: {normalized}. Use: ls {parent_path(target)}")
            if info.is_dir:
                return err(f"cat: path is a directory: {normalized}. Use: ls {normalized}")

            total_bytes += info.size
            limit_error = materialized_limit_error(ctx, "cat", normalized, total_bytes)
            if limit_error is not None:
                return limit_error

            raw = await ctx.vfs.read_bytes(target)
            if looks_binary(raw):
                return err(f"cat: binary file ({format_size(len(raw))}): {normalized}. Use: stat {normalized}")
            chunks.append(raw)
        except Exception as caught:
            escape_result = _escape_path_result("cat", caught, normalized)
            if escape_result is not None:
                return escape_result
            return err(f"cat: {error_message(caught)}")

    return ok_bytes(_concat_byte_chunks(chunks), "text/plain")


cat = CommandSpec(
    name="cat",
    summary="Read text from one or more files, or splice piped stdin with `-`.",
    usage=CAT_USAGE,
    details=(
        "Reads rooted text files or piped text. Use `-` to splice piped stdin into the file list. "
        "For directories use ls. For binary content use stat.\n"
        "Examples:\n"
        "  cat /notes/todo.txt\n"
        "  cat /notes/a.txt /notes/b.txt\n"
        "  grep ERROR /logs/app.log | cat\n"
        "  grep ERROR /logs/app.log | cat /notes/header.txt -"
    ),
    handler=cmd_cat,
    accepts_stdin=True,
    min_args=0,
    conformance_args=("/missing",),
)


async def cmd_write(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    if not args:
        return err("write: usage: write <path> [content]")

    content, content_error = content_from_args_or_stdin(args, stdin, "write")
    if content_error is not None:
        return content_error
    assert content is not None

    try:
        saved = await ctx.vfs.write_bytes(args[0], content)
        return ok(f"wrote {format_size(len(content))} to {saved}")
    except Exception as caught:
        code = error_code(caught)
        limit_message = _resource_limit_message("write", caught)
        if limit_message is not None:
            return err(limit_message)
        escape_result = _escape_path_result("write", caught, ctx.vfs.normalize(args[0]))
        if escape_result is not None:
            return escape_result
        if code == "EISDIR":
            normalized = ctx.vfs.normalize(args[0])
            return err(f"write: path is a directory: {normalized}. Use: ls {normalized}")
        if code == "ENOTDIR":
            return err(f"write: parent is not a directory: {await blocking_parent_path(ctx, args[0])}")
        if code == "EEXIST":
            blocking_path = await first_file_in_path(ctx, parent_path(args[0]))
            if blocking_path:
                return err(f"write: parent is not a directory: {blocking_path}")
        if code == "ENOENT":
            missing_parent = error_path(caught) or parent_path(args[0])
            return err(f"write: parent path not found: {missing_parent}. Use: mkdir {missing_parent}")
        return err(f"write: {error_message(caught)}")


write = CommandSpec(
    name="write",
    summary="Write a file from inline content or stdin.",
    usage="write <path> [content]",
    details="Examples:\n  write /notes/todo.txt \"line one\"\n  search \"refund issue\" | write /reports/refund.txt",
    handler=cmd_write,
    accepts_stdin=True,
    min_args=1,
    conformance_args=("/t.txt", "x"),
)


async def cmd_append(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    if not args:
        return err("append: usage: append <path> [content]")

    content, content_error = content_from_args_or_stdin(args, stdin, "append")
    if content_error is not None:
        return content_error
    assert content is not None

    try:
        saved = await ctx.vfs.append_bytes(args[0], content)
        return ok(f"appended {format_size(len(content))} to {saved}")
    except Exception as caught:
        code = error_code(caught)
        limit_message = _resource_limit_message("append", caught)
        if limit_message is not None:
            return err(limit_message)
        escape_result = _escape_path_result("append", caught, ctx.vfs.normalize(args[0]))
        if escape_result is not None:
            return escape_result
        if code == "EISDIR":
            normalized = ctx.vfs.normalize(args[0])
            return err(f"append: path is a directory: {normalized}. Use: ls {normalized}")
        if code == "ENOTDIR":
            return err(f"append: parent is not a directory: {await blocking_parent_path(ctx, args[0])}")
        if code == "EEXIST":
            blocking_path = await first_file_in_path(ctx, parent_path(args[0]))
            if blocking_path:
                return err(f"append: parent is not a directory: {blocking_path}")
        if code == "ENOENT":
            missing_parent = error_path(caught) or parent_path(args[0])
            return err(f"append: parent path not found: {missing_parent}. Use: mkdir {missing_parent}")
        return err(f"append: {error_message(caught)}")


append = CommandSpec(
    name="append",
    summary="Append to a file from inline content or stdin.",
    usage="append <path> [content]",
    details="Examples:\n  append /notes/todo.txt \"next item\"\n  cat /tmp/out.txt | append /notes/archive.txt",
    handler=cmd_append,
    accepts_stdin=True,
    min_args=1,
    conformance_args=("/t.txt", "x"),
)


async def cmd_mkdir(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    if stdin:
        return err("mkdir: does not accept stdin")

    path, error_text = _parse_single_path_args("mkdir", args, MKDIR_USAGE, ("-p",))
    if error_text is not None:
        return err(error_text)
    assert path is not None

    try:
        created = await ctx.vfs.mkdir(path, True)
        return ok(f"created {created}")
    except Exception as caught:
        code = error_code(caught)
        limit_message = _resource_limit_message("mkdir", caught)
        if limit_message is not None:
            return err(limit_message)
        escape_result = _escape_path_result("mkdir", caught, ctx.vfs.normalize(path))
        if escape_result is not None:
            return escape_result
        if code == "EEXIST":
            return err(f"mkdir: path already exists: {ctx.vfs.normalize(path)}")
        if code == "ENOTDIR":
            return err(f"mkdir: parent is not a directory: {await blocking_parent_path(ctx, path)}")
        if code == "ENOENT":
            return err(f"mkdir: parent path not found: {error_path(caught)}")
        return err(f"mkdir: {error_message(caught)}")


mkdir = CommandSpec(
    name="mkdir",
    summary="Create a directory and any missing parents.",
    usage=MKDIR_USAGE,
    details=(
        "Creates missing parents by default. `-p` is accepted as a compatibility alias.\n"
        "Examples:\n"
        "  mkdir /reports\n"
        "  mkdir -p notes/archive/2026"
    ),
    handler=cmd_mkdir,
    accepts_stdin=False,
    min_args=1,
    max_args=2,
    conformance_args=("/tmp",),
)


async def cmd_cp(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    if stdin:
        return err("cp: does not accept stdin")
    if len(args) != 2:
        return err("cp: usage: cp <src> <dst>")

    try:
        src, dst = await ctx.vfs.copy(args[0], args[1])
        return ok(f"copied {src} -> {dst}")
    except Exception as caught:
        code = error_code(caught)
        limit_message = _resource_limit_message("cp", caught)
        if limit_message is not None:
            return err(limit_message)
        escape_result = _escape_path_result("cp", caught, ctx.vfs.normalize(args[1]))
        if escape_result is not None:
            return escape_result
        if code == "ENOENT":
            return err(f"cp: source not found: {ctx.vfs.normalize(args[0])}")
        if code == "EEXIST":
            blocking_path = await first_file_in_path(ctx, parent_path(args[1]))
            if blocking_path:
                return err(f"cp: parent is not a directory: {blocking_path}")
            return err(f"cp: destination already exists: {ctx.vfs.normalize(args[1])}")
        if code == "EISDIR":
            normalized = ctx.vfs.normalize(args[1])
            return err(f"cp: destination is a directory: {normalized}. Use a file path.")
        if code == "ENOTDIR":
            return err(f"cp: parent is not a directory: {await blocking_parent_path(ctx, args[1])}")
        if code == "EINVAL":
            return err(f"cp: destination is inside the source directory: {ctx.vfs.normalize(args[1])}")
        return err(f"cp: {error_message(caught)}")


cp = CommandSpec(
    name="cp",
    summary="Copy a file or directory inside the rooted virtual file system.",
    usage="cp <src> <dst>",
    details=(
        "Copies files or directories to a new rooted destination path. "
        "The destination must not already exist.\n"
        "Examples:\n"
        "  cp /drafts/qbr.md /reports/qbr-v1.md"
    ),
    handler=cmd_cp,
    accepts_stdin=False,
    min_args=2,
    max_args=2,
    conformance_args=("/a", "/b"),
)


async def cmd_mv(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    if stdin:
        return err("mv: does not accept stdin")
    if len(args) != 2:
        return err("mv: usage: mv <src> <dst>")

    try:
        src, dst = await ctx.vfs.move(args[0], args[1])
        return ok(f"moved {src} -> {dst}")
    except Exception as caught:
        code = error_code(caught)
        limit_message = _resource_limit_message("mv", caught)
        if limit_message is not None:
            return err(limit_message)
        escape_result = _escape_path_result("mv", caught, ctx.vfs.normalize(args[1]))
        if escape_result is not None:
            return escape_result
        if code == "ENOENT":
            return err(f"mv: source not found: {ctx.vfs.normalize(args[0])}")
        if code == "EEXIST":
            blocking_path = await first_file_in_path(ctx, parent_path(args[1]))
            if blocking_path:
                return err(f"mv: parent is not a directory: {blocking_path}")
            return err(f"mv: destination already exists: {ctx.vfs.normalize(args[1])}")
        if code == "EISDIR":
            normalized = ctx.vfs.normalize(args[1])
            return err(f"mv: destination is a directory: {normalized}. Use a file path.")
        if code == "ENOTDIR":
            return err(f"mv: parent is not a directory: {await blocking_parent_path(ctx, args[1])}")
        if code == "EINVAL":
            return err(f"mv: destination is inside the source directory: {ctx.vfs.normalize(args[1])}")
        return err(f"mv: {error_message(caught)}")


mv = CommandSpec(
    name="mv",
    summary="Move or rename a file or directory.",
    usage="mv <src> <dst>",
    details=(
        "Moves files or directories to a new rooted destination path. "
        "The destination must not already exist.\n"
        "Examples:\n"
        "  mv /drafts/qbr.md /archive/qbr.md"
    ),
    handler=cmd_mv,
    accepts_stdin=False,
    min_args=2,
    max_args=2,
    conformance_args=("/a", "/b"),
)


async def cmd_rm(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    if stdin:
        return err("rm: does not accept stdin")

    path, error_text = _parse_single_path_args("rm", args, RM_USAGE, ("-r", "-R"))
    if error_text is not None:
        return err(error_text)
    assert path is not None

    try:
        removed = await ctx.vfs.delete(path)
        return ok(f"removed {removed}")
    except Exception as caught:
        code = error_code(caught)
        if code == "ENOENT":
            return err(f"rm: path not found: {ctx.vfs.normalize(path)}")
        escape_result = _escape_path_result("rm", caught, ctx.vfs.normalize(path))
        if escape_result is not None:
            return escape_result
        if code == "EROOT":
            return err("rm: cannot delete root: /")
        return err(f"rm: {error_message(caught)}")


rm = CommandSpec(
    name="rm",
    summary="Delete a file or directory recursively.",
    usage=RM_USAGE,
    details=(
        "Removes files and directories recursively by default. "
        "`-r` and `-R` are accepted as compatibility aliases.\n"
        "Examples:\n"
        "  rm /tmp/out.txt\n"
        "  rm -r /scratch"
    ),
    handler=cmd_rm,
    accepts_stdin=False,
    min_args=1,
    max_args=2,
    conformance_args=("/missing",),
)


async def cmd_find(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    if stdin:
        return err("find: does not accept stdin")

    parsed, error_text = _parse_find_args(args)
    if error_text is not None:
        return err(error_text)
    assert parsed is not None

    target_path = parsed["target_path"]
    start_path = target_path or "/"
    normalized_start = ctx.vfs.normalize(start_path)

    try:
        start_info = await ctx.vfs.stat(start_path)
        if not start_info.exists:
            return err(f"find: path not found: {normalized_start}")

        filters = _FindFilters(
            max_depth=parsed["max_depth"],
            type_filter=parsed["type_filter"],
            name_pattern=_compile_wildcard_pattern(parsed["name_pattern"]) if parsed["name_pattern"] else None,
        )
        matches: list[str] = []
        await _collect_find_matches(ctx, normalized_start, start_info.is_dir, 0, filters, matches)
        return ok("\n".join(matches))
    except Exception as caught:
        escape_result = _escape_path_result("find", caught, normalized_start)
        if escape_result is not None:
            return escape_result
        return err(f"find: {error_message(caught)}")


find = CommandSpec(
    name="find",
    summary="Recursively list files and directories with optional filters.",
    usage=FIND_USAGE,
    details="Examples:\n  find /logs\n  find /config -type f -name \"*.json\"\n  find /drafts --max-depth 1",
    handler=cmd_find,
    accepts_stdin=False,
    min_args=0,
    conformance_args=("/",),
)


async def cmd_diff(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    parsed, error_text = parse_diff_args(args)
    if error_text is not None:
        return err(f"diff: {error_text}", exit_code=2)
    assert parsed is not None
    return await run_diff_command(ctx, parsed, stdin)


diff = CommandSpec(
    name="diff",
    summary="Compare files or directories with normal, unified, or context output.",
    usage="diff [-u|-U N|-c|-C N] [-r] [-a] [-b] [-i] <left> <right>",
    details=(
        "Examples:\n"
        "  diff /drafts/a.txt /reports/a.txt\n"
        "  diff -u /drafts/a.txt /reports/a.txt\n"
        "  diff -r /left /right"
    ),
    handler=cmd_diff,
    accepts_stdin=True,
    min_args=2,
    conformance_args=("/", "/"),
)


async def _collect_find_matches(
    ctx: CommandContext,
    current_path: str,
    is_dir: bool,
    depth: int,
    filters: _FindFilters,
    matches: list[str],
) -> None:
    if _matches_find_filters(current_path, is_dir, filters):
        matches.append(current_path)
    if not is_dir or depth >= filters.max_depth:
        return

    entries = sorted(await ctx.vfs.listdir(current_path), key=_compare_path_entry_key)
    for entry in entries:
        child_name = entry[:-1] if entry.endswith("/") else entry
        child_path = current_path if current_path == "/" else current_path
        child_path = f"/{child_name}" if current_path == "/" else f"{current_path}/{child_name}"
        child_info = await ctx.vfs.stat(child_path)
        await _collect_find_matches(ctx, child_info.path, child_info.is_dir, depth + 1, filters, matches)


def _matches_find_filters(path: str, is_dir: bool, filters: _FindFilters) -> bool:
    if filters.type_filter == "file" and is_dir:
        return False
    if filters.type_filter == "dir" and not is_dir:
        return False
    if filters.name_pattern is not None and filters.name_pattern.fullmatch(base_name(path)) is None:
        return False
    return True


def _compile_wildcard_pattern(pattern: str) -> re.Pattern[str]:
    escaped = re.escape(pattern).replace(r"\*", ".*").replace(r"\?", ".")
    return re.compile(f"^{escaped}$")


def _parse_ls_args(args: list[str]) -> tuple[_LsOptions | None, str | None]:
    options = _LsOptions(all=False, long=False, recursive=False, target_path="/")
    path_assigned = False
    parsing_options = True

    for arg in args:
        if parsing_options and arg == "--":
            parsing_options = False
            continue
        if parsing_options and arg.startswith("-") and arg != "-":
            all_flag = options.all
            long_flag = options.long
            recursive_flag = options.recursive
            for flag in arg[1:]:
                if flag == "1":
                    continue
                if flag == "a":
                    all_flag = True
                    continue
                if flag == "l":
                    long_flag = True
                    continue
                if flag == "R":
                    recursive_flag = True
                    continue
                return (None, f"ls: unknown option: -{flag}. Usage: {LS_USAGE}")
            options = _LsOptions(
                all=all_flag,
                long=long_flag,
                recursive=recursive_flag,
                target_path=options.target_path,
            )
            continue

        if path_assigned:
            return (None, f"ls: usage: {LS_USAGE}")
        options = _LsOptions(
            all=options.all,
            long=options.long,
            recursive=options.recursive,
            target_path=arg,
        )
        path_assigned = True

    return (options, None)


async def _collect_ls_sections(
    ctx: CommandContext,
    directory_path: str,
    options: _LsOptions,
) -> list[dict[str, object]]:
    sections: list[dict[str, object]] = []
    await _collect_ls_section_recursive(ctx, directory_path, options, sections)
    return sections


async def _collect_ls_section_recursive(
    ctx: CommandContext,
    directory_path: str,
    options: _LsOptions,
    sections: list[dict[str, object]],
) -> None:
    entries = await _list_ls_entries(ctx, directory_path, options)
    sections.append({"path": directory_path, "entries": entries})
    for entry in entries:
        if entry.is_synthetic or not entry.info.is_dir:
            continue
        child_path = f"/{entry.display_name}" if directory_path == "/" else f"{directory_path}/{entry.display_name}"
        await _collect_ls_section_recursive(ctx, child_path, options, sections)


async def _list_ls_entries(
    ctx: CommandContext,
    directory_path: str,
    options: _LsOptions,
) -> list[_LsEntry]:
    raw_entries = await ctx.vfs.listdir(directory_path)
    entries: list[_LsEntry] = []

    if options.all:
        current_info = await ctx.vfs.stat(directory_path)
        parent_info = await ctx.vfs.stat(parent_path(directory_path))
        entries.append(_create_ls_entry(".", current_info, True))
        entries.append(_create_ls_entry("..", parent_info, True))

    for raw_entry in raw_entries:
        entry_name = raw_entry[:-1] if raw_entry.endswith("/") else raw_entry
        if not options.all and entry_name.startswith("."):
            continue
        entry_path = f"/{entry_name}" if directory_path == "/" else f"{directory_path}/{entry_name}"
        info = await ctx.vfs.stat(entry_path)
        entries.append(_create_ls_entry(entry_name, info))

    return sorted(entries, key=_compare_ls_entry_key)


def _create_ls_entry(display_name: str, info: VFileInfo, is_synthetic: bool = False) -> _LsEntry:
    return _LsEntry(display_name=display_name, info=info, is_synthetic=is_synthetic)


def _compare_ls_entry_key(entry: _LsEntry) -> tuple[int, str, str]:
    return (_ls_special_entry_rank(entry.display_name), entry.display_name.lower(), entry.display_name)


def _compare_path_entry_key(value: str) -> tuple[str, str]:
    name = value[:-1] if value.endswith("/") else value
    return (name.lower(), name)


def _ls_special_entry_rank(display_name: str) -> int:
    if display_name == ".":
        return -2
    if display_name == "..":
        return -1
    return 0


def _render_ls_output(entries: list[_LsEntry], options: _LsOptions) -> str:
    return "\n".join(_render_ls_entry(entry, options) for entry in entries)


def _render_recursive_ls_output(sections: list[dict[str, object]], options: _LsOptions) -> str:
    rendered_sections: list[str] = []
    for section in sections:
        body = _render_ls_output(section["entries"], options)  # type: ignore[arg-type]
        path = str(section["path"])
        rendered_sections.append(f"{path}:\n{body}" if body else f"{path}:")
    return "\n\n".join(rendered_sections)


def _render_ls_entry(entry: _LsEntry, options: _LsOptions) -> str:
    if not options.long:
        return entry.display_name
    return " ".join(
        [
            "d" if entry.info.is_dir else "-",
            str(entry.info.size).rjust(8, " "),
            _format_ls_timestamp(entry.info.modified_epoch_ms),
            entry.display_name,
        ]
    )


def _format_ls_timestamp(modified_epoch_ms: int) -> str:
    return (
        dt.datetime.fromtimestamp(modified_epoch_ms / 1000, tz=dt.timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _parse_find_args(args: list[str]) -> tuple[dict[str, object] | None, str | None]:
    target_path: str | None = None
    type_filter: str | None = None
    name_pattern: str | None = None
    max_depth = 10**9
    parsing_options = True

    index = 0
    while index < len(args):
        arg = args[index]
        if parsing_options and arg == "--":
            parsing_options = False
            index += 1
            continue
        if parsing_options and arg in {"--type", "-type"}:
            value = args[index + 1] if index + 1 < len(args) else None
            if value is None:
                return (None, f"find: missing value for {arg}. Usage: {FIND_USAGE}")
            normalized = _normalize_find_type_value(value)
            if normalized is None:
                return (None, f"find: invalid value for {arg}: {value}. Expected file, dir, f, or d.")
            type_filter = normalized
            index += 2
            continue
        if parsing_options and arg in {"--name", "-name"}:
            value = args[index + 1] if index + 1 < len(args) else None
            if value is None:
                return (None, f"find: missing value for {arg}. Usage: {FIND_USAGE}")
            name_pattern = value
            index += 2
            continue
        if parsing_options and arg in {"--max-depth", "-maxdepth"}:
            value = args[index + 1] if index + 1 < len(args) else None
            if value is None:
                return (None, f"find: missing value for {arg}. Usage: {FIND_USAGE}")
            try:
                parsed_depth = int(value, 10)
            except ValueError:
                return (None, f"find: invalid integer for {arg}: {value}")
            if parsed_depth < 0:
                return (None, f"find: invalid integer for {arg}: {value}")
            max_depth = parsed_depth
            index += 2
            continue
        if parsing_options and arg.startswith("-") and arg != "-":
            return (None, f"find: unknown option: {arg}. Usage: {FIND_USAGE}")
        if target_path is not None:
            return (None, f"find: usage: {FIND_USAGE}")
        target_path = arg
        index += 1

    return (
        {
            "target_path": target_path,
            "type_filter": type_filter,
            "name_pattern": name_pattern,
            "max_depth": max_depth,
        },
        None,
    )


def _normalize_find_type_value(value: str) -> str | None:
    if value in {"file", "f"}:
        return "file"
    if value in {"dir", "d"}:
        return "dir"
    return None


fs_commands = [ls, stat, cat, write, append, mkdir, cp, diff, mv, rm, find]
