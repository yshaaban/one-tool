from __future__ import annotations

import re
from dataclasses import dataclass

from ...c_locale import C_LOCALE_REGEX_FLAGS
from ...types import CommandResult, err, ok_bytes
from ...utils import build_c_locale_case_insensitive_regex_source, error_message, parent_path
from ...vfs.errors import format_escape_path_error_message, format_resource_limit_error_message
from ..core import CommandContext
from .errors import blocking_parent_path, error_code, first_file_in_path
from .io import materialized_limit_error
from .line_model import decode_c_locale_text, encode_c_locale_text, normalize_c_locale_input_text


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
    value: int | str | None
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
    negated: bool
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
    return ok_bytes(output, "text/plain")


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
                script_source = parsed_option["script_source"]  # type: ignore[assignment]
                if parsed_option.get("script_source_is_c_locale"):
                    script_sources.append(script_source)  # type: ignore[arg-type]
                else:
                    script_sources.append(_normalize_sed_script_source(script_source))  # type: ignore[arg-type]
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
        script_sources.append(_normalize_sed_script_source(inline_script))
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
                "script_source_is_c_locale": True,
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
                    "script_source_is_c_locale": True,
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
    return (decode_c_locale_text(data), None)


def _parse_sed_commands(script: str, extended_regex: bool) -> tuple[list[SedCommand], str | None]:
    commands: list[SedCommand] = []
    index = 0

    while index < len(script):
        index = _skip_sed_separators(script, index)
        if index >= len(script):
            break

        command, index, error_text = _parse_sed_command(script, index, extended_regex)
        if error_text is not None:
            return ([], error_text)
        assert command is not None
        commands.append(command)

    if not commands:
        return ([], "empty script")

    return (commands, None)


def _parse_sed_command(
    raw: str,
    start_index: int,
    extended_regex: bool,
) -> tuple[SedCommand | None, int, str | None]:
    index = start_index
    address1, index, error_text = _parse_sed_address(raw, index, extended_regex)
    if error_text is not None:
        return (None, start_index, error_text)
    address2: SedAddress | None = None
    negated = False
    if address1 is not None:
        index = _skip_sed_horizontal_whitespace(raw, index)
    if address1 is not None and index < len(raw) and raw[index] == ",":
        address2, index, error_text = _parse_sed_address(raw, index + 1, extended_regex)
        if error_text is not None:
            return (None, start_index, error_text)
        if address2 is None:
            return (None, start_index, "missing second address")
        index = _skip_sed_horizontal_whitespace(raw, index)

    if not _has_valid_zero_address_usage(address1, address2):
        return (None, start_index, "invalid usage of line address 0")

    index = _skip_sed_horizontal_whitespace(raw, index)
    if index < len(raw) and raw[index] == "!":
        negated = True
        index += 1
        index = _skip_sed_horizontal_whitespace(raw, index)

    if index >= len(raw):
        return (None, start_index, "unexpected end of script")

    kind = raw[index]
    index += 1
    if kind in {"p", "d", "q", "n"}:
        mapped_kind = {
            "p": "print",
            "d": "delete",
            "q": "quit",
            "n": "next",
        }[kind]
        return (SedCommand(address1, address2, negated, mapped_kind), _finish_sed_simple_command(raw, index), None)
    if kind in {"a", "i", "c"}:
        text = _parse_sed_text_argument(raw, index)
        mapped_kind = {
            "a": "append",
            "i": "insert",
            "c": "change",
        }[kind]
        return (
            SedCommand(address1, address2, negated, mapped_kind, text=text),
            _advance_past_sed_text_argument(raw, index),
            None,
        )
    if kind == "s":
        substitute, next_index, error_text = _parse_sed_substitute(raw, index, extended_regex)
        if error_text is not None:
            return (None, start_index, error_text)
        return (SedCommand(address1, address2, negated, "substitute", substitute=substitute), next_index, None)
    return (None, start_index, f"unsupported sed command: {kind}")


def _parse_sed_address(
    raw: str,
    index: int,
    extended_regex: bool,
) -> tuple[SedAddress | None, int, str | None]:
    if index >= len(raw):
        return (None, index, None)
    if raw[index] == "0" and (index + 1 >= len(raw) or not raw[index + 1].isdigit()):
        return (SedAddress("zero", None), index + 1, None)
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
        try:
            regex = _compile_sed_regex(pattern, extended_regex, False)
        except re.error as caught:
            return (None, index, f"invalid address regex: {error_message(caught)}")
        return (SedAddress("regex", pattern, regex=regex), end + 1, None)
    return (None, index, None)


def _has_valid_zero_address_usage(address1: SedAddress | None, address2: SedAddress | None) -> bool:
    if address1 is None or address1.kind != "zero":
        return True
    return address2 is not None and address2.kind == "regex"


def _skip_sed_horizontal_whitespace(raw: str, index: int) -> int:
    while index < len(raw) and raw[index] in {" ", "\t", "\r"}:
        index += 1
    return index


def _parse_sed_substitute(
    source: str,
    start_index: int,
    extended_regex: bool,
) -> tuple[SedSubstitute | None, int, str | None]:
    if start_index >= len(source):
        return (None, start_index, "invalid substitute delimiter")
    delimiter = source[start_index]
    if delimiter in {"\n", ";", "\\"}:
        return (None, start_index, "invalid substitute delimiter")

    pattern, next_index, ok = _parse_sed_delimited_content(source, start_index + 1, delimiter)
    if not ok:
        return (None, start_index, "unterminated substitute pattern")
    replacement, next_index, ok = _parse_sed_delimited_content(source, next_index, delimiter)
    if not ok:
        return (None, start_index, "unterminated substitute replacement")

    global_flag, print_on_success, occurrence, ignore_case, next_index, error_text = _parse_sed_substitute_flags(
        source,
        next_index,
    )
    if error_text is not None:
        return (None, start_index, error_text)

    try:
        regex = _compile_sed_regex(pattern, extended_regex, ignore_case)
    except re.error as caught:
        return (None, start_index, f"invalid regex: {error_message(caught)}")

    return (
        SedSubstitute(
            source=pattern,
            replacement=replacement,
            global_flag=global_flag,
            print_on_success=print_on_success,
            occurrence=occurrence,
            ignore_case=ignore_case,
            regex=regex,
        ),
        next_index,
        None,
    )


def _parse_sed_delimited_content(source: str, start_index: int, delimiter: str) -> tuple[str, int, bool]:
    pieces: list[str] = []
    index = start_index
    escaped = False

    while index < len(source):
        char = source[index]
        if escaped:
            pieces.append(f"\\{char}")
            escaped = False
            index += 1
            continue
        if char == "\\":
            escaped = True
            index += 1
            continue
        if char == delimiter:
            return ("".join(pieces), index + 1, True)
        pieces.append(char)
        index += 1

    return ("", index, False)


def _parse_sed_substitute_flags(
    source: str,
    start_index: int,
) -> tuple[bool, bool, int | None, bool, int, str | None]:
    global_flag = False
    print_on_success = False
    occurrence: int | None = None
    ignore_case = False
    index = start_index
    digits = ""

    while index < len(source):
        char = source[index]
        if char in {";", "\n"}:
            break
        if char in {" ", "\t", "\r"}:
            index += 1
            continue
        if char.isdigit():
            digits += char
            index += 1
            continue
        if digits:
            occurrence = int(digits, 10)
            digits = ""

        if char == "g":
            global_flag = True
            index += 1
            continue
        if char == "p":
            print_on_success = True
            index += 1
            continue
        if char in {"i", "I"}:
            ignore_case = True
            index += 1
            continue
        return (False, False, None, False, start_index, f"unsupported substitute flag: {char}")

    if digits:
        occurrence = int(digits, 10)

    return (
        global_flag,
        print_on_success,
        occurrence,
        ignore_case,
        _finish_sed_simple_command(source, index),
        None,
    )


def _parse_sed_text_argument(source: str, start_index: int) -> str:
    index = _skip_sed_horizontal_whitespace(source, start_index)
    if index < len(source) and source[index] == "\\":
        index += 1
    return _decode_sed_text_escapes(source[index : _find_sed_line_end(source, index)])


def _decode_sed_text_escapes(text: str) -> str:
    pieces: list[str] = []
    index = 0
    while index < len(text):
        char = text[index]
        if char != "\\" or index == len(text) - 1:
            pieces.append(char)
            index += 1
            continue

        next_char = text[index + 1]
        if next_char == "n":
            pieces.append("\n")
        elif next_char == "t":
            pieces.append("\t")
        else:
            pieces.append(next_char)
        index += 2

    return "".join(pieces)


def _advance_past_sed_text_argument(source: str, start_index: int) -> int:
    end_index = _find_sed_line_end(source, start_index)
    if end_index < len(source) and source[end_index] == "\n":
        return end_index + 1
    return end_index


def _find_sed_line_end(source: str, start_index: int) -> int:
    index = start_index
    while index < len(source) and source[index] != "\n":
        index += 1
    return index


def _skip_sed_separators(source: str, index: int) -> int:
    next_index = index
    while next_index < len(source):
        char = source[next_index]
        if char in {";", "\n", " ", "\t", "\r"}:
            next_index += 1
            continue
        break
    return next_index


def _finish_sed_simple_command(source: str, index: int) -> int:
    next_index = index
    while next_index < len(source):
        char = source[next_index]
        if char in {" ", "\t", "\r"}:
            next_index += 1
            continue
        if char in {";", "\n"}:
            return next_index + 1
        break
    return next_index


def _compile_sed_regex(pattern: str, extended_regex: bool, ignore_case: bool) -> re.Pattern[str]:
    source = _translate_sed_extended_regex(pattern) if extended_regex else _translate_sed_basic_regex(pattern)
    if ignore_case:
        source = build_c_locale_case_insensitive_regex_source(source)
    return re.compile(source, C_LOCALE_REGEX_FLAGS)


def _normalize_sed_script_source(source: str) -> str:
    return normalize_c_locale_input_text(source)


def _translate_sed_extended_regex(pattern: str) -> str:
    return pattern


def _translate_sed_basic_regex(pattern: str) -> str:
    pieces: list[str] = []
    index = 0

    while index < len(pattern):
        char = pattern[index]
        if char == "\\":
            if index == len(pattern) - 1:
                pieces.append(r"\\")
                break

            next_char = pattern[index + 1]
            if next_char in {"(", ")", "{", "}", "+", "?", "|"}:
                pieces.append(next_char)
            elif next_char.isdigit():
                pieces.append(f"\\{next_char}")
            else:
                pieces.append(_escape_sed_regex_literal(next_char))
            index += 2
            continue

        if char == "[":
            character_class, index = _read_sed_character_class(pattern, index)
            pieces.append(character_class)
            continue

        if char in {"(", ")", "{", "}", "+", "?", "|"}:
            pieces.append(f"\\{char}")
            index += 1
            continue

        pieces.append(char)
        index += 1

    return "".join(pieces)


def _read_sed_character_class(pattern: str, start_index: int) -> tuple[str, int]:
    index = start_index + 1

    while index < len(pattern):
        char = pattern[index]
        if char == "\\":
            index += 2
            continue
        if char == "]" and index > start_index + 1:
            return (pattern[start_index : index + 1], index + 1)
        index += 1

    return (pattern[start_index:], len(pattern))


def _escape_sed_regex_literal(char: str) -> str:
    if char in {"\\", "^", "$", ".", "*", "+", "?", "(", ")", "[", "]", "{", "}", "|"}:
        return f"\\{char}"
    return char


def _render_sed_replacement(replacement: str, match: re.Match[str]) -> str:
    pieces: list[str] = []
    index = 0

    while index < len(replacement):
        char = replacement[index]
        if char == "&":
            pieces.append(match.group(0))
            index += 1
            continue
        if char != "\\":
            pieces.append(char)
            index += 1
            continue

        if index == len(replacement) - 1:
            pieces.append("\\")
            index += 1
            continue

        next_char = replacement[index + 1]
        if next_char.isdigit():
            group_index = int(next_char, 10)
            pieces.append(_match_group_text(match, group_index))
            index += 2
            continue
        if next_char == "n":
            pieces.append("\n")
            index += 2
            continue
        if next_char == "t":
            pieces.append("\t")
            index += 2
            continue

        pieces.append(next_char)
        index += 2

    return "".join(pieces)


def _match_group_text(match: re.Match[str], group_index: int) -> str:
    if group_index > match.re.groups:
        return ""
    value = match.group(group_index)
    return value or ""


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
    cursor = 0

    while cursor < len(stream):
        line = stream[cursor]
        current_line = line
        current_text = line.text
        current_terminated = line.terminated
        next_cursor = cursor + 1
        deleted = False
        suppress_default = False
        print_after: list[SedInputLine] = []
        print_before: list[SedInputLine] = []

        for command, state in zip(program.commands, states):
            matched, started_range = _match_sed_command(command, current_line, state)
            if not matched:
                continue

            if command.kind == "insert":
                print_before.extend(_sed_text_records(command.text or ""))
                continue
            if command.kind == "append":
                print_after.extend(_sed_text_records(command.text or ""))
                continue
            if command.kind == "change":
                if started_range or command.address2 is None or command.negated:
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
                records.extend(print_after)
                print_after = []
                if next_cursor >= len(stream):
                    deleted = True
                    suppress_default = True
                    quit_requested = True
                    break
                current_line = stream[next_cursor]
                current_text = current_line.text
                current_terminated = current_line.terminated
                next_cursor += 1
                continue
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

        cursor = next_cursor

    return (_render_sed_records(records), None)


def _match_sed_command(
    command: SedCommand,
    line: _SedCycleLine,
    state: _SedState,
) -> tuple[bool, bool]:
    matched, started_range = _match_sed_command_base(command, line, state)
    if not command.negated:
        return (matched, started_range)
    return (not matched, False)


def _match_sed_command_base(
    command: SedCommand,
    line: _SedCycleLine,
    state: _SedState,
) -> tuple[bool, bool]:
    if command.address1 is None:
        return (True, False)
    if command.address2 is None:
        return (_matches_sed_address(command.address1, line), False)
    if state.in_range:
        if _closes_sed_range(command.address2, line, True):
            state.in_range = False
        return (True, False)
    if _matches_sed_address(command.address1, line):
        matched_second = _closes_sed_range(command.address2, line, command.address1.kind == "zero")
        state.in_range = not matched_second
        return (True, True)
    return (False, False)


def _matches_sed_address(address: SedAddress, line: _SedCycleLine) -> bool:
    if address.kind == "zero":
        return line.absolute_index == 1
    if address.kind == "line":
        return line.absolute_index == int(address.value)
    if address.kind == "last":
        return line.is_last_line
    assert address.regex is not None
    return address.regex.search(line.text) is not None


def _closes_sed_range(address: SedAddress, line: _SedCycleLine, allow_regex_match: bool) -> bool:
    if address.kind == "zero":
        return True
    if address.kind == "line":
        return line.absolute_index >= int(address.value)
    if address.kind == "last":
        return line.is_last_line
    if address.kind == "regex":
        return allow_regex_match and address.regex.search(line.text) is not None
    return False


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
        pieces.append(_render_sed_replacement(substitute.replacement, match))
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

    return ok_bytes(b"", "text/plain")


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
