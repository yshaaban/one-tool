from __future__ import annotations

import re
from dataclasses import dataclass

from ...types import CommandResult, err, ok
from ...utils import error_message, parent_path
from ...vfs.errors import format_escape_path_error_message, format_resource_limit_error_message
from ..core import CommandContext
from .errors import blocking_parent_path, error_code, first_file_in_path
from .io import materialized_limit_error
from .line_model import decode_c_locale_text, encode_c_locale_text


@dataclass(frozen=True, slots=True)
class ParsedSedProgram:
    quiet: bool
    extended_regex: bool
    in_place_suffix: str | None
    commands: tuple["SedCommand", ...]
    input_files: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class SedAddress:
    kind: str
    value: int | str
    regex: re.Pattern[str] | None = None


@dataclass(frozen=True, slots=True)
class SedSubstitute:
    source: str
    replacement: str
    global_flag: bool
    print_on_success: bool
    occurrence: int | None
    ignore_case: bool
    regex: re.Pattern[str]


@dataclass(frozen=True, slots=True)
class SedCommand:
    address1: SedAddress | None
    address2: SedAddress | None
    kind: str
    text: str | None = None
    substitute: SedSubstitute | None = None


@dataclass(frozen=True, slots=True)
class SedInputLine:
    text: str
    terminated: bool


@dataclass(frozen=True, slots=True)
class SedInputFile:
    path: str | None
    display_name: str
    lines: tuple[SedInputLine, ...]
    original_bytes: bytes


@dataclass(slots=True)
class _SedState:
    in_range: bool = False


@dataclass(frozen=True, slots=True)
class _SedCycleLine:
    text: str
    terminated: bool
    absolute_index: int
    is_last_line: bool


async def run_sed_command(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    parsed, error_result = await _parse_sed_program(ctx, args)
    if error_result is not None:
        return error_result
    assert parsed is not None

    inputs, error_result = await _load_sed_inputs(ctx, parsed, stdin)
    if error_result is not None:
        return error_result
    assert inputs is not None

    if parsed.in_place_suffix is not None:
        return await _apply_sed_in_place(ctx, parsed, inputs)

    output, error_result = _execute_sed_program(parsed, inputs)
    if error_result is not None:
        return error_result
    return ok(output.decode("latin1"), content_type="text/plain")


async def _parse_sed_program(
    ctx: CommandContext,
    args: list[str],
) -> tuple[ParsedSedProgram | None, CommandResult | None]:
    quiet = False
    extended_regex = False
    in_place_suffix: str | None = None
    parsing_options = True
    inline_script: str | None = None
    script_sources: list[str] = []
    input_files: list[str] = []

    index = 0
    while index < len(args):
        arg = args[index]
        if parsing_options and arg == "--":
            parsing_options = False
            index += 1
            continue

        if parsing_options and arg.startswith("-") and arg != "-":
            parsed_option, error_result, next_index = await _parse_sed_option(ctx, args, index, arg)
            if error_result is not None:
                return (None, error_result)
            assert parsed_option is not None

            quiet = quiet or parsed_option["quiet"]
            extended_regex = extended_regex or parsed_option["extended_regex"]
            if "in_place_suffix" in parsed_option:
                in_place_suffix = parsed_option["in_place_suffix"]  # type: ignore[assignment]
            if "script_source" in parsed_option:
                script_sources.append(parsed_option["script_source"])  # type: ignore[arg-type]
            index = next_index + 1
            continue

        if inline_script is None and not script_sources:
            inline_script = arg
            parsing_options = False
            index += 1
            continue

        input_files.append(arg)
        parsing_options = False
        index += 1

    if inline_script is not None:
        script_sources.append(inline_script)
    if not script_sources:
        return (None, err("sed: missing script. Usage: sed [OPTION]... [SCRIPT] [INPUTFILE...]"))

    commands, error_text = _parse_sed_commands("\n".join(script_sources), extended_regex)
    if error_text is not None:
        return (None, err(f"sed: {error_text}"))

    if in_place_suffix is not None and not input_files:
        return (None, err("sed: -i requires at least one input file"))
    if in_place_suffix is not None and "-" in input_files:
        return (None, err("sed: cannot use -i with stdin"))

    return (
        ParsedSedProgram(
            quiet=quiet,
            extended_regex=extended_regex,
            in_place_suffix=in_place_suffix,
            commands=tuple(commands),
            input_files=tuple(input_files),
        ),
        None,
    )


async def _parse_sed_option(
    ctx: CommandContext,
    args: list[str],
    index: int,
    arg: str,
) -> tuple[dict[str, object] | None, CommandResult | None, int]:
    if arg == "-n":
        return ({"quiet": True, "extended_regex": False}, None, index)
    if arg == "-E":
        return ({"quiet": False, "extended_regex": True}, None, index)
    if arg == "-i":
        return ({"quiet": False, "extended_regex": False, "in_place_suffix": ""}, None, index)
    if arg.startswith("-i") and len(arg) > 2:
        return (
            {"quiet": False, "extended_regex": False, "in_place_suffix": arg[2:]},
            None,
            index,
        )
    if arg == "-e" or arg.startswith("-e"):
        script = arg[2:] if len(arg) > 2 else (args[index + 1] if index + 1 < len(args) else None)
        if script is None:
            return (None, err("sed: missing script for -e"), index)
        return (
            {
                "quiet": False,
                "extended_regex": False,
                "script_source": script,
            },
            None,
            index if len(arg) > 2 else index + 1,
        )
    if arg == "-f" or arg.startswith("-f"):
        script_path = arg[2:] if len(arg) > 2 else (args[index + 1] if index + 1 < len(args) else None)
        if script_path is None:
            return (None, err("sed: missing script file for -f"), index)
        loaded_script, error_result = await _read_sed_script_file(ctx, script_path)
        if error_result is not None:
            return (None, error_result, index)
        return (
            {
                "quiet": False,
                "extended_regex": False,
                "script_source": loaded_script,
            },
            None,
            index if len(arg) > 2 else index + 1,
        )

    quiet = False
    extended_regex = False
    scan_index = 1
    while scan_index < len(arg):
        flag = arg[scan_index]
        if flag == "n":
            quiet = True
            scan_index += 1
            continue
        if flag == "E":
            extended_regex = True
            scan_index += 1
            continue
        if flag == "i":
            return (
                {
                    "quiet": quiet,
                    "extended_regex": extended_regex,
                    "in_place_suffix": arg[scan_index + 1 :],
                },
                None,
                index,
            )
        if flag == "e":
            script = arg[scan_index + 1 :] or (args[index + 1] if index + 1 < len(args) else None)
            if script is None:
                return (None, err("sed: missing script for -e"), index)
            return (
                {
                    "quiet": quiet,
                    "extended_regex": extended_regex,
                    "script_source": script,
                },
                None,
                index if arg[scan_index + 1 :] else index + 1,
            )
        if flag == "f":
            script_path = arg[scan_index + 1 :] or (args[index + 1] if index + 1 < len(args) else None)
            if script_path is None:
                return (None, err("sed: missing script file for -f"), index)
            loaded_script, error_result = await _read_sed_script_file(ctx, script_path)
            if error_result is not None:
                return (None, error_result, index)
            return (
                {
                    "quiet": quiet,
                    "extended_regex": extended_regex,
                    "script_source": loaded_script,
                },
                None,
                index if arg[scan_index + 1 :] else index + 1,
            )
        return (None, err(f"sed: unknown option: -{flag}"), index)

    return ({"quiet": quiet, "extended_regex": extended_regex}, None, index)


async def _read_sed_script_file(
    ctx: CommandContext,
    file_path: str,
) -> tuple[str | None, CommandResult | None]:
    normalized = ctx.vfs.normalize(file_path)

    try:
        info = await ctx.vfs.stat(file_path)
    except Exception as caught:
        return (None, await _format_sed_path_error(ctx, file_path, caught, "script file not found"))

    if not info.exists:
        blocked = await first_file_in_path(ctx, normalized)
        if blocked is not None:
            return (None, err(f"sed: parent is not a directory: {blocked}"))
        return (None, err(f"sed: script file not found: {normalized}. Use: ls {parent_path(file_path)}"))
    if info.is_dir:
        return (None, err(f"sed: script path is a directory: {normalized}. Use: ls {normalized}"))

    limit_error = materialized_limit_error(ctx, "sed", normalized, info.size)
    if limit_error is not None:
        return (None, limit_error)

    data = await ctx.vfs.read_bytes(file_path)
    return (data.decode("utf-8"), None)


def _parse_sed_commands(script: str, extended_regex: bool) -> tuple[list[SedCommand], str | None]:
    commands: list[SedCommand] = []
    for raw in _split_sed_script(script):
        command, error_text = _parse_sed_command(raw, extended_regex)
        if error_text is not None:
            return ([], error_text)
        assert command is not None
        commands.append(command)
    return (commands, None)


def _split_sed_script(script: str) -> list[str]:
    commands: list[str] = []
    for line in script.splitlines():
        stripped = line.strip()
        if stripped == "":
            continue
        commands.append(stripped)
    return commands


def _parse_sed_command(raw: str, extended_regex: bool) -> tuple[SedCommand | None, str | None]:
    index = 0
    address1, index, error_text = _parse_sed_address(raw, index, extended_regex)
    if error_text is not None:
        return (None, error_text)
    address2: SedAddress | None = None
    if address1 is not None and index < len(raw) and raw[index] == ",":
        address2, index, error_text = _parse_sed_address(raw, index + 1, extended_regex)
        if error_text is not None:
            return (None, error_text)
        if address2 is None:
            return (None, "missing second address")

    if index >= len(raw):
        return (None, "missing sed command")

    kind = raw[index]
    payload = raw[index + 1 :]
    if kind in {"p", "d", "q", "n"}:
        mapped_kind = {
            "p": "print",
            "d": "delete",
            "q": "quit",
            "n": "next",
        }[kind]
        return (SedCommand(address1, address2, mapped_kind), None)
    if kind in {"a", "i", "c"}:
        text = payload[1:] if payload.startswith("\\") else payload
        mapped_kind = {
            "a": "append",
            "i": "insert",
            "c": "change",
        }[kind]
        return (SedCommand(address1, address2, mapped_kind, text=text), None)
    if kind == "s":
        substitute, error_text = _parse_sed_substitute(payload, extended_regex)
        if error_text is not None:
            return (None, error_text)
        return (SedCommand(address1, address2, "substitute", substitute=substitute), None)
    return (None, f"unsupported sed command: {kind}")


def _parse_sed_address(
    raw: str,
    index: int,
    extended_regex: bool,
) -> tuple[SedAddress | None, int, str | None]:
    if index >= len(raw):
        return (None, index, None)
    if raw[index].isdigit():
        start = index
        while index < len(raw) and raw[index].isdigit():
            index += 1
        return (SedAddress("line", int(raw[start:index], 10)), index, None)
    if raw[index] == "$":
        return (SedAddress("last", "$"), index + 1, None)
    if raw[index] == "/":
        end = index + 1
        escaped = False
        while end < len(raw):
            char = raw[end]
            if char == "/" and not escaped:
                break
            escaped = char == "\\" and not escaped
            if char != "\\":
                escaped = False
            end += 1
        if end >= len(raw) or raw[end] != "/":
            return (None, index, "unterminated regex address")
        pattern = raw[index + 1 : end]
        flags = re.MULTILINE
        try:
            regex = re.compile(pattern, flags)
        except re.error as caught:
            return (None, index, f"invalid address regex: {error_message(caught)}")
        return (SedAddress("regex", pattern, regex=regex), end + 1, None)
    return (None, index, None)


def _parse_sed_substitute(source: str, extended_regex: bool) -> tuple[SedSubstitute | None, str | None]:
    if source == "":
        return (None, "missing substitute delimiter")
    delimiter = source[0]
    parts: list[str] = []
    current: list[str] = []
    escaped = False
    index = 1
    while index < len(source):
        char = source[index]
        if char == delimiter and not escaped:
            parts.append("".join(current))
            current = []
            index += 1
            if len(parts) == 2:
                break
            continue
        if char == "\\" and not escaped:
            escaped = True
            current.append(char)
            index += 1
            continue
        escaped = False
        current.append(char)
        index += 1
    else:
        return (None, "unterminated substitute command")

    flags_text = source[index:]
    pattern, replacement = parts
    global_flag = "g" in flags_text
    print_on_success = "p" in flags_text
    ignore_case = "i" in flags_text

    occurrence_text = "".join(char for char in flags_text if char.isdigit())
    occurrence = int(occurrence_text, 10) if occurrence_text else None
    regex_flags = re.MULTILINE | (re.IGNORECASE if ignore_case else 0)
    try:
        regex = re.compile(pattern, regex_flags)
    except re.error as caught:
        return (None, f"invalid regex: {error_message(caught)}")

    return (
        SedSubstitute(
            source=pattern,
            replacement=_decode_sed_replacement(replacement),
            global_flag=global_flag,
            print_on_success=print_on_success,
            occurrence=occurrence,
            ignore_case=ignore_case,
            regex=regex,
        ),
        None,
    )


def _decode_sed_replacement(value: str) -> str:
    return value.replace(r"\n", "\n").replace(r"\/", "/")


async def _load_sed_inputs(
    ctx: CommandContext,
    program: ParsedSedProgram,
    stdin: bytes,
) -> tuple[tuple[SedInputFile, ...] | None, CommandResult | None]:
    if not program.input_files:
        return ((SedInputFile(None, "stdin", _split_sed_input(stdin), bytes(stdin)),), None)

    inputs: list[SedInputFile] = []
    for path in program.input_files:
        normalized = ctx.vfs.normalize(path)
        try:
            info = await ctx.vfs.stat(path)
        except Exception as caught:
            return (None, await _format_sed_path_error(ctx, path, caught, "input file not found"))

        if not info.exists:
            blocked = await first_file_in_path(ctx, normalized)
            if blocked is not None:
                return (None, err(f"sed: parent is not a directory: {blocked}"))
            return (None, err(f"sed: input file not found: {normalized}. Use: ls {parent_path(path)}"))
        if info.is_dir:
            return (None, err(f"sed: input path is a directory: {normalized}. Use: ls {normalized}"))

        limit_error = materialized_limit_error(ctx, "sed", normalized, info.size)
        if limit_error is not None:
            return (None, limit_error)

        raw = await ctx.vfs.read_bytes(path)
        inputs.append(SedInputFile(path, normalized, _split_sed_input(raw), raw))

    return (tuple(inputs), None)


def _split_sed_input(data: bytes) -> tuple[SedInputLine, ...]:
    if not data:
        return ()
    text = decode_c_locale_text(data)
    parts = text.split("\n")
    lines: list[SedInputLine] = []
    for index, part in enumerate(parts):
        if index == len(parts) - 1 and part == "":
            continue
        terminated = index < len(parts) - 1
        lines.append(SedInputLine(text=part, terminated=terminated))
    return tuple(lines)


def _execute_sed_program(
    program: ParsedSedProgram,
    inputs: tuple[SedInputFile, ...],
) -> tuple[bytes | None, CommandResult | None]:
    states = [_SedState() for _ in program.commands]
    stream: list[_SedCycleLine] = []
    absolute_index = 1
    total_lines = sum(len(input_file.lines) for input_file in inputs)

    for input_file in inputs:
        for line in input_file.lines:
            stream.append(
                _SedCycleLine(
                    text=line.text,
                    terminated=line.terminated,
                    absolute_index=absolute_index,
                    is_last_line=absolute_index == total_lines,
                )
            )
            absolute_index += 1

    records: list[SedInputLine] = []
    quit_requested = False

    for line in stream:
        current_text = line.text
        current_terminated = line.terminated
        deleted = False
        suppress_default = False
        print_after: list[SedInputLine] = []
        print_before: list[SedInputLine] = []

        for command, state in zip(program.commands, states):
            matched, started_range = _match_sed_command(command, line, state)
            if not matched:
                continue

            if command.kind == "insert":
                print_before.extend(_sed_text_records(command.text or ""))
                continue
            if command.kind == "append":
                print_after.extend(_sed_text_records(command.text or ""))
                continue
            if command.kind == "change":
                if started_range or command.address2 is None:
                    print_before.extend(_sed_text_records(command.text or ""))
                deleted = True
                suppress_default = True
                continue
            if command.kind == "delete":
                deleted = True
                suppress_default = True
                break
            if command.kind == "print":
                records.extend(print_before)
                print_before = []
                records.append(SedInputLine(current_text, current_terminated))
                continue
            if command.kind == "quit":
                quit_requested = True
                break
            if command.kind == "next":
                if not program.quiet and not suppress_default and not deleted:
                    records.extend(print_before)
                    print_before = []
                    records.append(SedInputLine(current_text, current_terminated))
                deleted = True
                suppress_default = True
                break
            if command.kind == "substitute" and command.substitute is not None:
                current_text, changed = _apply_sed_substitute(current_text, command.substitute)
                if changed and command.substitute.print_on_success:
                    records.extend(print_before)
                    print_before = []
                    records.append(SedInputLine(current_text, current_terminated))

        records.extend(print_before)
        if not program.quiet and not suppress_default and not deleted:
            records.append(SedInputLine(current_text, current_terminated))
        records.extend(print_after)

        if quit_requested:
            break

    return (_render_sed_records(records), None)


def _match_sed_command(
    command: SedCommand,
    line: _SedCycleLine,
    state: _SedState,
) -> tuple[bool, bool]:
    if command.address1 is None:
        return (True, False)
    if command.address2 is None:
        return (_matches_sed_address(command.address1, line), False)
    if state.in_range:
        if _matches_sed_address(command.address2, line):
            state.in_range = False
        return (True, False)
    if _matches_sed_address(command.address1, line):
        matched_second = _matches_sed_address(command.address2, line)
        state.in_range = not matched_second
        return (True, True)
    return (False, False)


def _matches_sed_address(address: SedAddress, line: _SedCycleLine) -> bool:
    if address.kind == "line":
        return line.absolute_index == int(address.value)
    if address.kind == "last":
        return line.is_last_line
    assert address.regex is not None
    return address.regex.search(line.text) is not None


def _apply_sed_substitute(text: str, substitute: SedSubstitute) -> tuple[str, bool]:
    matches = list(substitute.regex.finditer(text))
    if not matches:
        return (text, False)

    if substitute.occurrence is not None and substitute.occurrence > len(matches):
        return (text, False)

    target_indexes: set[int]
    if substitute.occurrence is None:
        target_indexes = {0} if not substitute.global_flag else set(range(len(matches)))
    elif substitute.global_flag:
        target_indexes = set(range(substitute.occurrence - 1, len(matches)))
    else:
        target_indexes = {substitute.occurrence - 1}

    pieces: list[str] = []
    last_end = 0
    changed = False
    for index, match in enumerate(matches):
        if index not in target_indexes:
            continue
        pieces.append(text[last_end : match.start()])
        pieces.append(match.expand(substitute.replacement))
        last_end = match.end()
        changed = True
    if not changed:
        return (text, False)
    pieces.append(text[last_end:])
    return ("".join(pieces), True)


def _sed_text_records(text: str) -> list[SedInputLine]:
    if text == "":
        return [SedInputLine("", True)]
    return [SedInputLine(part, True) for part in text.split("\n")]


def _render_sed_records(records: list[SedInputLine]) -> bytes:
    output = bytearray()
    for record in records:
        output.extend(encode_c_locale_text(record.text))
        if record.terminated:
            output.extend(b"\n")
    return bytes(output)


async def _apply_sed_in_place(
    ctx: CommandContext,
    program: ParsedSedProgram,
    inputs: tuple[SedInputFile, ...],
) -> CommandResult:
    for input_file in inputs:
        single_program = ParsedSedProgram(
            quiet=program.quiet,
            extended_regex=program.extended_regex,
            in_place_suffix=program.in_place_suffix,
            commands=program.commands,
            input_files=(input_file.display_name,),
        )
        output, error_result = _execute_sed_program(single_program, (input_file,))
        if error_result is not None:
            return error_result
        assert output is not None

        try:
            if program.in_place_suffix:
                await ctx.vfs.write_bytes(
                    f"{input_file.display_name}{program.in_place_suffix}",
                    input_file.original_bytes,
                )
            assert input_file.path is not None
            await ctx.vfs.write_bytes(input_file.path, output)
        except Exception as caught:
            return await _format_sed_write_error(ctx, input_file.display_name, caught)

    return ok("")


async def _format_sed_path_error(
    ctx: CommandContext,
    file_path: str,
    caught: object,
    missing_message: str,
) -> CommandResult:
    limit_message = format_resource_limit_error_message("sed", caught)
    if limit_message is not None:
        return err(limit_message)
    escape_message = format_escape_path_error_message("sed", caught, ctx.vfs.normalize(file_path))
    if escape_message is not None:
        return err(escape_message)
    if error_code(caught) == "ENOTDIR":
        return err(f"sed: parent is not a directory: {await blocking_parent_path(ctx, file_path)}")
    return err(f"sed: {missing_message}: {ctx.vfs.normalize(file_path)}")


async def _format_sed_write_error(
    ctx: CommandContext,
    file_path: str,
    caught: object,
) -> CommandResult:
    limit_message = format_resource_limit_error_message("sed", caught)
    if limit_message is not None:
        return err(limit_message)
    escape_message = format_escape_path_error_message("sed", caught, ctx.vfs.normalize(file_path))
    if escape_message is not None:
        return err(escape_message)
    code = error_code(caught)
    if code == "ENOTDIR":
        return err(f"sed: parent is not a directory: {await blocking_parent_path(ctx, file_path)}")
    return err(f"sed: {error_message(caught)}")
