from __future__ import annotations

import math
import re
from dataclasses import dataclass
from functools import cmp_to_key

from ...c_locale import compile_c_locale_regex, compare_c_locale_text, fold_ascii_case_text
from ...types import CommandResult, err, ok, ok_bytes
from ...utils import (
    error_message,
    format_size,
    looks_binary,
    split_lines,
)
from ..core import CommandContext, CommandSpec
from ..shared.bytes import read_bytes_from_file_or_stdin
from ..shared.io import read_text_from_file_or_stdin
from ..shared.line_model import create_byte_line_model, encode_c_locale_text, normalize_c_locale_input_text
from ..shared.sed import run_sed_command
from ..shared.tr_arrays import compile_tr_program

GREP_USAGE = "grep [-i] [-v] [-c] [-n] [-F] [-E] [-o] [-w] [-x] [-q] <pattern> [path]"
HEAD_USAGE = "head [-n N|-c N|-N] [path]"
TAIL_USAGE = "tail [-n N|-c N|-N] [path]"
SORT_USAGE = "sort [-r] [-n] [-u] [-f] [-V] [path]"
UNIQ_USAGE = "uniq [-c] [-d] [-i] [-u] [path]"
WC_USAGE = "wc [-l] [-w] [-c] [path]"
_WORD_CHAR_PATTERN = re.compile(r"[0-9A-Za-z_]")
_NEGATIVE_COUNT_PATTERN = re.compile(r"^-\d+$")
_VERSION_TOKEN_PATTERN = re.compile(r"[0-9]+|[^0-9]+")
_ASCII_DIGIT_0 = ord("0")
_ASCII_DIGIT_9 = ord("9")


@dataclass(frozen=True, slots=True)
class EchoArgs:
    interpret_escapes: bool
    suppress_trailing_newline: bool
    words: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class GrepOptions:
    count_only: bool
    ignore_case: bool
    invert: bool
    line_numbers: bool
    match_mode: str
    only_matching: bool
    quiet: bool
    whole_line: bool
    word_match: bool


@dataclass(frozen=True, slots=True)
class ParsedGrepArgs:
    file_path: str | None
    options: GrepOptions
    pattern: str


@dataclass(frozen=True, slots=True)
class GrepLineMatch:
    line_number: int
    segments: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class TextSliceArgs:
    count: int
    file_path: str | None
    mode: str


@dataclass(frozen=True, slots=True)
class SortOptions:
    file_path: str | None
    ignore_case: bool
    numeric: bool
    reverse: bool
    unique: bool
    version: bool


@dataclass(frozen=True, slots=True)
class SortEntry:
    index: int
    line: str


@dataclass(frozen=True, slots=True)
class WcOptions:
    bytes: bool
    file_path: str | None
    lines: bool
    words: bool


@dataclass(frozen=True, slots=True)
class UniqOptions:
    count: bool
    duplicates_only: bool
    file_path: str | None
    ignore_case: bool
    unique_only: bool


class GrepMatcher:
    def search(self, line: str) -> list[str]:
        raise NotImplementedError


class FixedGrepMatcher(GrepMatcher):
    def __init__(self, pattern: str, options: GrepOptions) -> None:
        self._needle = fold_ascii_case_text(pattern) if options.ignore_case else pattern
        self._options = options

    def search(self, line: str) -> list[str]:
        haystack = fold_ascii_case_text(line) if self._options.ignore_case else line

        if self._options.whole_line:
            return [line] if haystack == self._needle else []

        matches: list[str] = []
        start_index = 0
        while self._needle:
            match_index = haystack.find(self._needle, start_index)
            if match_index == -1:
                break

            end_index = match_index + len(self._needle)
            if not self._options.word_match or is_whole_word_match(line, match_index, end_index):
                matches.append(line[match_index:end_index])
            start_index = match_index + max(len(self._needle), 1)

        return matches


class RegexGrepMatcher(GrepMatcher):
    def __init__(self, regex: re.Pattern[str]) -> None:
        self._regex = regex

    def search(self, line: str) -> list[str]:
        return [match.group(0) for match in self._regex.finditer(line)]


async def cmd_echo(_ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    if stdin:
        return err("echo: does not accept stdin")

    parsed = parse_echo_args(args)
    output = render_echo_output(parsed)
    return ok(output)


def parse_echo_args(args: list[str]) -> EchoArgs:
    interpret_escapes = False
    suppress_trailing_newline = False
    words: list[str] = []
    parsing_options = True

    for arg in args:
        if not parsing_options or arg == "-" or not arg.startswith("-") or re.fullmatch(r"-[nEe]+", arg) is None:
            parsing_options = False
            words.append(arg)
            continue

        for flag in arg[1:]:
            if flag == "n":
                suppress_trailing_newline = True
            elif flag == "e":
                interpret_escapes = True
            elif flag == "E":
                interpret_escapes = False

    return EchoArgs(
        interpret_escapes=interpret_escapes,
        suppress_trailing_newline=suppress_trailing_newline,
        words=tuple(words),
    )


def render_echo_output(args: EchoArgs) -> str:
    suppress_from_escape, text = decode_echo_escapes(" ".join(args.words), args.interpret_escapes)
    if suppress_from_escape or args.suppress_trailing_newline:
        return text
    return f"{text}\n"


def decode_echo_escapes(value: str, interpret_escapes: bool) -> tuple[bool, str]:
    if not interpret_escapes:
        return (False, value)

    output: list[str] = []
    index = 0
    while index < len(value):
        char = value[index]
        if char != "\\" or index == len(value) - 1:
            output.append(char)
            index += 1
            continue

        index += 1
        escape = value[index]
        if escape == "a":
            output.append("\u0007")
        elif escape == "b":
            output.append("\b")
        elif escape == "c":
            return (True, "".join(output))
        elif escape in {"e", "E"}:
            output.append("\u001b")
        elif escape == "f":
            output.append("\f")
        elif escape == "n":
            output.append("\n")
        elif escape == "r":
            output.append("\r")
        elif escape == "t":
            output.append("\t")
        elif escape == "v":
            output.append("\v")
        elif escape == "\\":
            output.append("\\")
        else:
            output.append(f"\\{escape}")
        index += 1

    return (False, "".join(output))


echo = CommandSpec(
    name="echo",
    summary="Write arguments back as plain text output. Supports -n, -e, and -E.",
    usage="echo [-n] [-e|-E] [text ...]",
    details=(
        "Examples:\n"
        "  echo hello world\n"
        '  echo -n "ready for review"\n'
        '  echo -e "line 1\\nline 2"\n'
        "  echo status:ok | write /notes/status.txt"
    ),
    handler=cmd_echo,
    accepts_stdin=False,
    min_args=0,
    conformance_args=(),
)


async def cmd_grep(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    if not args:
        return err(f"grep: usage: {GREP_USAGE}")

    parsed, error_text = parse_grep_args(args)
    if error_text is not None:
        return err(error_text)
    assert parsed is not None

    loaded = await read_bytes_from_file_or_stdin(ctx, parsed.file_path, stdin, "grep")
    if loaded.error is not None:
        return loaded.error
    assert loaded.data is not None and loaded.source is not None

    if looks_binary(loaded.data):
        if loaded.source == "stdin":
            return err(
                f"grep: stdin is binary ({format_size(len(loaded.data))}). "
                "Pipe text only, or save binary data to a file and inspect with stat."
            )
        return err(
            f"grep: binary file ({format_size(len(loaded.data))}): {loaded.source}. "
            f"Use: stat {loaded.source}"
        )

    matcher, error_text = build_grep_matcher(parsed.pattern, parsed.options)
    if error_text is not None:
        return err(error_text)
    assert matcher is not None

    line_model = create_byte_line_model(loaded.data)
    matches = collect_grep_matches([line.text for line in line_model.lines], matcher, parsed.options)
    if parsed.options.quiet:
        return create_successful_grep_result("", bool(matches))
    if parsed.options.count_only:
        return create_successful_grep_result(str(len(matches)), bool(matches))
    return create_successful_grep_result(format_grep_matches(matches, parsed.options), bool(matches))


def parse_grep_args(args: list[str]) -> tuple[ParsedGrepArgs | None, str | None]:
    options = GrepOptions(
        count_only=False,
        ignore_case=False,
        invert=False,
        line_numbers=False,
        match_mode="regex",
        only_matching=False,
        quiet=False,
        whole_line=False,
        word_match=False,
    )
    remaining: list[str] = []
    parsing_options = True

    for arg in args:
        if not parsing_options or arg == "-" or not arg.startswith("-"):
            remaining.append(arg)
            parsing_options = False
            continue
        if arg == "--":
            parsing_options = False
            continue

        for flag in arg[1:]:
            if flag == "i":
                options = replace_grep_options(options, ignore_case=True)
            elif flag == "v":
                options = replace_grep_options(options, invert=True)
            elif flag == "c":
                options = replace_grep_options(options, count_only=True)
            elif flag == "n":
                options = replace_grep_options(options, line_numbers=True)
            elif flag == "F":
                options = replace_grep_options(options, match_mode="fixed")
            elif flag == "E":
                options = replace_grep_options(options, match_mode="regex")
            elif flag == "o":
                options = replace_grep_options(options, only_matching=True)
            elif flag == "w":
                options = replace_grep_options(options, word_match=True)
            elif flag == "x":
                options = replace_grep_options(options, whole_line=True)
            elif flag == "q":
                options = replace_grep_options(options, quiet=True)
            else:
                return (None, f"grep: unknown option: -{flag}. Usage: {GREP_USAGE}")

    if not remaining:
        return (None, f"grep: missing pattern. Usage: {GREP_USAGE}")
    if len(remaining) > 2:
        return (None, f"grep: too many arguments. Usage: {GREP_USAGE}")

    return (
        ParsedGrepArgs(
            file_path=remaining[1] if len(remaining) > 1 else None,
            options=options,
            pattern=remaining[0],
        ),
        None,
    )


def replace_grep_options(options: GrepOptions, **changes: object) -> GrepOptions:
    return GrepOptions(
        count_only=bool(changes.get("count_only", options.count_only)),
        ignore_case=bool(changes.get("ignore_case", options.ignore_case)),
        invert=bool(changes.get("invert", options.invert)),
        line_numbers=bool(changes.get("line_numbers", options.line_numbers)),
        match_mode=str(changes.get("match_mode", options.match_mode)),
        only_matching=bool(changes.get("only_matching", options.only_matching)),
        quiet=bool(changes.get("quiet", options.quiet)),
        whole_line=bool(changes.get("whole_line", options.whole_line)),
        word_match=bool(changes.get("word_match", options.word_match)),
    )


def build_grep_matcher(pattern: str, options: GrepOptions) -> tuple[GrepMatcher | None, str | None]:
    normalized_pattern = normalize_c_locale_input_text(pattern)

    if options.match_mode == "fixed":
        return (FixedGrepMatcher(normalized_pattern, options), None)

    source = normalized_pattern
    if options.word_match:
        source = rf"\b(?:{source})\b"
    if options.whole_line:
        source = rf"^(?:{source})$"

    try:
        return (RegexGrepMatcher(compile_c_locale_regex(source, ignore_case=options.ignore_case)), None)
    except re.error as caught:
        return (None, f"grep: invalid regex: {error_message(caught)}")


def collect_grep_matches(lines: list[str], matcher: GrepMatcher, options: GrepOptions) -> list[GrepLineMatch]:
    matches: list[GrepLineMatch] = []

    for index, line in enumerate(lines, start=1):
        segments = matcher.search(line)
        has_match = bool(segments)
        selected = not has_match if options.invert else has_match
        if not selected:
            continue

        matches.append(
            GrepLineMatch(
                line_number=index,
                segments=tuple(resolve_displayed_grep_segments(line, segments, options)),
            )
        )

    return matches


def resolve_displayed_grep_segments(line: str, segments: list[str], options: GrepOptions) -> list[str]:
    if options.invert:
        return [line]
    if segments:
        return segments if options.only_matching else [line]
    return [line]


def format_grep_matches(matches: list[GrepLineMatch], options: GrepOptions) -> str:
    output_lines: list[str] = []

    for match in matches:
        prefix = f"{match.line_number}:" if options.line_numbers else ""
        for segment in match.segments:
            output_lines.append(f"{prefix}{segment}")

    return "\n".join(output_lines)


def create_successful_grep_result(text: str, matched: bool) -> CommandResult:
    return CommandResult(
        stdout=encode_c_locale_text(text),
        stderr="",
        exit_code=0 if matched else 1,
        content_type="text/plain",
    )


def is_whole_word_match(line: str, start_index: int, end_index: int) -> bool:
    previous = "" if start_index == 0 else line[start_index - 1]
    following = "" if end_index >= len(line) else line[end_index]
    return not is_word_char(previous) and not is_word_char(following)


def is_word_char(char: str) -> bool:
    return bool(char) and _WORD_CHAR_PATTERN.fullmatch(char) is not None


grep = CommandSpec(
    name="grep",
    summary="Filter lines by pattern. Supports a common GNU grep subset.",
    usage=GREP_USAGE,
    details=(
        "Examples:\n"
        "  grep ERROR /logs/app.log\n"
        "  cat /logs/app.log | grep -i timeout\n"
        '  grep -F -o "timeout" /logs/app.log\n'
        '  grep -c "payment failed" /logs/app.log'
    ),
    handler=cmd_grep,
    accepts_stdin=True,
    min_args=1,
    conformance_args=("pattern",),
)


async def cmd_head(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    parsed, error_text = parse_text_slice_args("head", args)
    if error_text is not None:
        return err(error_text)
    assert parsed is not None

    if parsed.mode == "bytes":
        loaded = await read_bytes_from_file_or_stdin(ctx, parsed.file_path, stdin, "head")
        if loaded.error is not None:
            return loaded.error
        return render_slice_bytes((loaded.data or b"")[: parsed.count])

    loaded = await read_text_from_file_or_stdin(ctx, parsed.file_path, stdin, "head")
    if loaded.error is not None:
        return loaded.error

    return ok("".join(split_line_chunks(loaded.text or "")[: parsed.count]))


head = CommandSpec(
    name="head",
    summary="Show the first N lines or bytes from stdin or a file.",
    usage=HEAD_USAGE,
    details=(
        "Examples:\n"
        "  head -n 20 /logs/app.log\n"
        "  head -c 16 /notes/todo.txt\n"
        '  search "refund API" | head -n 5'
    ),
    handler=cmd_head,
    accepts_stdin=True,
    min_args=0,
    conformance_args=(),
)


async def cmd_tail(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    parsed, error_text = parse_text_slice_args("tail", args)
    if error_text is not None:
        return err(error_text)
    assert parsed is not None

    if parsed.mode == "bytes":
        loaded = await read_bytes_from_file_or_stdin(ctx, parsed.file_path, stdin, "tail")
        if loaded.error is not None:
            return loaded.error
        data = loaded.data or b""
        start_index = max(len(data) - parsed.count, 0)
        return render_slice_bytes(data[start_index:])

    loaded = await read_text_from_file_or_stdin(ctx, parsed.file_path, stdin, "tail")
    if loaded.error is not None:
        return loaded.error

    lines = split_line_chunks(loaded.text or "")
    return ok("".join(lines[max(len(lines) - parsed.count, 0) :]))


tail = CommandSpec(
    name="tail",
    summary="Show the last N lines or bytes from stdin or a file.",
    usage=TAIL_USAGE,
    details=(
        "Examples:\n"
        "  tail -n 20 /logs/app.log\n"
        "  tail -c 16 /notes/todo.txt\n"
        "  cat /logs/app.log | tail -n 50"
    ),
    handler=cmd_tail,
    accepts_stdin=True,
    min_args=0,
    conformance_args=(),
)


async def cmd_sort(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    parsed, error_text = parse_sort_args(args)
    if error_text is not None:
        return err(error_text)
    assert parsed is not None

    loaded = await read_text_from_file_or_stdin(ctx, parsed.file_path, stdin, "sort")
    if loaded.error is not None:
        return loaded.error

    lines = split_lines(loaded.text or "")
    decorated = [SortEntry(line=line, index=index) for index, line in enumerate(lines)]
    decorated.sort(
        key=cmp_to_key(
            lambda left, right: compare_sort_entries(left, right, parsed),
        )
    )

    if parsed.unique:
        output_lines = dedupe_sorted_entries(decorated, parsed)
    else:
        output_lines = [entry.line for entry in decorated]

    return ok("\n".join(output_lines))


def compare_sort_entries(left: SortEntry, right: SortEntry, options: SortOptions) -> int:
    comparison = compare_sort_lines(left.line, right.line, options)
    if comparison == 0 and not options.unique:
        comparison = compare_text_sort_lines(left.line, right.line, False)
    if comparison != 0:
        return -comparison if options.reverse else comparison
    return left.index - right.index


sort = CommandSpec(
    name="sort",
    summary="Sort lines from stdin or a file.",
    usage=SORT_USAGE,
    details=(
        "Examples:\n"
        "  sort /notes/todo.txt\n"
        "  sort -f /tmp/names.txt\n"
        "  sort -V /tmp/releases.txt\n"
        "  find /config -type f | sort -r"
    ),
    handler=cmd_sort,
    accepts_stdin=True,
    min_args=0,
    conformance_args=(),
)


async def cmd_sed(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    if not args:
        return err("sed: missing script. Usage: sed [OPTION]... [SCRIPT] [INPUTFILE...]")
    return await run_sed_command(ctx, args, stdin)


sed = CommandSpec(
    name="sed",
    summary="Stream editor with in-place editing, addresses, and substitutions.",
    usage="sed [OPTION]... [SCRIPT] [INPUTFILE...]",
    details=(
        "Supports a GNU-compatible subset: addresses (line, $, /regex/, range), commands p/d/q/n/s/a/i/c, "
        "and options -n, -e, -f, -E, -i[SUFFIX]. Common clustered short options like -ne and -nEf<file> "
        "also work.\n"
        'Examples:\n  sed "s/ERROR/WARN/" /logs/app.log\n  sed -n "1,5p" /logs/app.log\n'
        '  sed -i.bak "s/us-east-1/us-west-2/" /config/app.env'
    ),
    handler=cmd_sed,
    accepts_stdin=True,
    min_args=1,
    conformance_args=("s/a/A/",),
)


async def cmd_tr(_ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    compiled, error_text = compile_tr_program(args)
    if error_text is not None:
        return err(f"tr: {error_text}")
    assert compiled is not None

    output = compiled.run(stdin)
    return ok_bytes(output, "application/octet-stream" if looks_binary(output) else "text/plain")


tr = CommandSpec(
    name="tr",
    summary="Translate, delete, and squeeze bytes from stdin.",
    usage="tr [OPTION]... STRING1 [STRING2]",
    details=(
        "Examples:\n"
        "  cat /logs/app.log | tr a-z A-Z\n"
        '  cat /notes.txt | tr -s " "\n'
        "  cat /data.txt | tr -d 0-9"
    ),
    handler=cmd_tr,
    accepts_stdin=True,
    min_args=1,
    conformance_args=("a-z", "A-Z"),
)


async def cmd_uniq(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    parsed, error_text = parse_uniq_args(args)
    if error_text is not None:
        return err(error_text)
    assert parsed is not None

    loaded = await read_text_from_file_or_stdin(ctx, parsed.file_path, stdin, "uniq")
    if loaded.error is not None:
        return loaded.error

    lines = split_lines(loaded.text or "")
    if not lines:
        return ok("")

    output_lines: list[str] = []
    current_line = lines[0]
    current_key = uniq_key(current_line, parsed.ignore_case)
    current_count = 1

    for line in lines[1:]:
        key = uniq_key(line, parsed.ignore_case)
        if key == current_key:
            current_count += 1
            continue

        if should_include_uniq_group(current_count, parsed):
            output_lines.append(render_uniq_line(current_line, current_count, parsed.count))
        current_line = line
        current_key = key
        current_count = 1

    if should_include_uniq_group(current_count, parsed):
        output_lines.append(render_uniq_line(current_line, current_count, parsed.count))

    return ok("\n".join(output_lines))


uniq = CommandSpec(
    name="uniq",
    summary="Collapse adjacent duplicate lines from stdin or a file.",
    usage=UNIQ_USAGE,
    details=(
        "Examples:\n"
        "  sort /logs/errors.txt | uniq -c\n"
        "  sort /logs/errors.txt | uniq -d\n"
        "  cat /notes/todo.txt | uniq\n"
        "  uniq -i /tmp/names.txt"
    ),
    handler=cmd_uniq,
    accepts_stdin=True,
    min_args=0,
    conformance_args=(),
)


async def cmd_wc(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    parsed, error_text = parse_wc_args(args)
    if error_text is not None:
        return err(error_text)
    assert parsed is not None

    loaded = await read_text_from_file_or_stdin(ctx, parsed.file_path, stdin, "wc")
    if loaded.error is not None:
        return loaded.error

    text = loaded.text or ""
    counts = {
        "byte_count": len(text.encode("utf-8")),
        "line_count": count_line_breaks(text),
        "word_count": count_words(text),
    }
    return ok(render_wc_output(parsed, counts, ctx))


wc = CommandSpec(
    name="wc",
    summary="Count lines, words, and bytes from stdin or a file.",
    usage=WC_USAGE,
    details="Examples:\n  wc /logs/app.log\n  wc -l /logs/app.log\n  fetch text:runbook | wc -w",
    handler=cmd_wc,
    accepts_stdin=True,
    min_args=0,
    conformance_args=(),
)


def parse_text_slice_args(command_name: str, args: list[str]) -> tuple[TextSliceArgs | None, str | None]:
    count = 10
    file_path: str | None = None
    mode = "lines"

    index = 0
    while index < len(args):
        arg = args[index]

        if _NEGATIVE_COUNT_PATTERN.fullmatch(arg) is not None:
            count = int(arg[1:], 10)
            mode = "lines"
            index += 1
            continue

        if arg in {"-n", "-c"}:
            if index + 1 >= len(args):
                return (None, f"{command_name}: missing value for {arg}. Usage: {text_slice_usage(command_name)}")
            parsed_count = parse_slice_count_value(args[index + 1])
            if parsed_count is None:
                return (None, f"{command_name}: invalid integer for {arg}: {args[index + 1]}")
            count = parsed_count
            mode = "bytes" if arg == "-c" else "lines"
            index += 2
            continue

        if arg.startswith("-n") and len(arg) > 2:
            parsed_count = parse_slice_count_value(arg[2:])
            if parsed_count is None:
                return (None, f"{command_name}: invalid integer for -n: {arg[2:]}")
            count = parsed_count
            mode = "lines"
            index += 1
            continue

        if arg.startswith("-c") and len(arg) > 2:
            parsed_count = parse_slice_count_value(arg[2:])
            if parsed_count is None:
                return (None, f"{command_name}: invalid integer for -c: {arg[2:]}")
            count = parsed_count
            mode = "bytes"
            index += 1
            continue

        if arg.startswith("-"):
            return (None, f"{command_name}: unknown option: {arg}. Usage: {text_slice_usage(command_name)}")

        if file_path is not None:
            return (None, f"{command_name}: usage: {text_slice_usage(command_name)}")

        file_path = arg
        index += 1

    return (TextSliceArgs(count=count, file_path=file_path, mode=mode), None)


def parse_sort_args(args: list[str]) -> tuple[SortOptions | None, str | None]:
    options = SortOptions(
        file_path=None,
        ignore_case=False,
        numeric=False,
        reverse=False,
        unique=False,
        version=False,
    )

    for arg in args:
        if arg.startswith("-") and arg != "-":
            for flag in arg[1:]:
                if flag == "f":
                    options = replace_sort_options(options, ignore_case=True)
                elif flag == "n":
                    options = replace_sort_options(options, numeric=True)
                elif flag == "r":
                    options = replace_sort_options(options, reverse=True)
                elif flag == "u":
                    options = replace_sort_options(options, unique=True)
                elif flag == "V":
                    options = replace_sort_options(options, version=True)
                else:
                    return (None, f"sort: unknown option: -{flag}. Usage: {SORT_USAGE}")
            continue

        if options.file_path is None:
            options = replace_sort_options(options, file_path=arg)
            continue

        return (None, f"sort: usage: {SORT_USAGE}")

    return (options, None)


def replace_sort_options(options: SortOptions, **changes: object) -> SortOptions:
    return SortOptions(
        file_path=changes.get("file_path", options.file_path),
        ignore_case=bool(changes.get("ignore_case", options.ignore_case)),
        numeric=bool(changes.get("numeric", options.numeric)),
        reverse=bool(changes.get("reverse", options.reverse)),
        unique=bool(changes.get("unique", options.unique)),
        version=bool(changes.get("version", options.version)),
    )


def parse_wc_args(args: list[str]) -> tuple[WcOptions | None, str | None]:
    options = WcOptions(bytes=False, file_path=None, lines=False, words=False)

    for arg in args:
        if arg.startswith("-") and arg != "-":
            for flag in arg[1:]:
                if flag == "c":
                    options = replace_wc_options(options, bytes=True)
                elif flag == "l":
                    options = replace_wc_options(options, lines=True)
                elif flag == "w":
                    options = replace_wc_options(options, words=True)
                else:
                    return (None, f"wc: unknown option: -{flag}. Usage: {WC_USAGE}")
            continue

        if options.file_path is None:
            options = replace_wc_options(options, file_path=arg)
            continue

        return (None, f"wc: usage: {WC_USAGE}")

    return (options, None)


def replace_wc_options(options: WcOptions, **changes: object) -> WcOptions:
    return WcOptions(
        bytes=bool(changes.get("bytes", options.bytes)),
        file_path=changes.get("file_path", options.file_path),
        lines=bool(changes.get("lines", options.lines)),
        words=bool(changes.get("words", options.words)),
    )


def parse_uniq_args(args: list[str]) -> tuple[UniqOptions | None, str | None]:
    options = UniqOptions(
        count=False,
        duplicates_only=False,
        file_path=None,
        ignore_case=False,
        unique_only=False,
    )

    for arg in args:
        if arg.startswith("-") and arg != "-":
            for flag in arg[1:]:
                if flag == "c":
                    options = replace_uniq_options(options, count=True)
                elif flag == "d":
                    options = replace_uniq_options(options, duplicates_only=True)
                elif flag == "i":
                    options = replace_uniq_options(options, ignore_case=True)
                elif flag == "u":
                    options = replace_uniq_options(options, unique_only=True)
                else:
                    return (None, f"uniq: unknown option: -{flag}. Usage: {UNIQ_USAGE}")
            continue

        if options.file_path is None:
            options = replace_uniq_options(options, file_path=arg)
            continue

        if arg.startswith("-"):
            return (None, f"uniq: unknown option: {arg}. Usage: {UNIQ_USAGE}")

        return (None, f"uniq: usage: {UNIQ_USAGE}")

    return (options, None)


def replace_uniq_options(options: UniqOptions, **changes: object) -> UniqOptions:
    return UniqOptions(
        count=bool(changes.get("count", options.count)),
        duplicates_only=bool(changes.get("duplicates_only", options.duplicates_only)),
        file_path=changes.get("file_path", options.file_path),
        ignore_case=bool(changes.get("ignore_case", options.ignore_case)),
        unique_only=bool(changes.get("unique_only", options.unique_only)),
    )


def compare_sort_lines(left: str, right: str, options: SortOptions) -> int:
    if options.version:
        return compare_version_sort_lines(left, right, options.ignore_case)

    if not options.numeric:
        return compare_text_sort_lines(left, right, options.ignore_case)

    left_number = numeric_sort_value(left)
    right_number = numeric_sort_value(right)

    if left_number is not None and right_number is not None:
        if left_number == right_number:
            return compare_text_sort_lines(left, right, options.ignore_case)
        return -1 if left_number < right_number else 1
    if left_number is not None:
        return 1
    if right_number is not None:
        return -1

    return compare_text_sort_lines(left, right, options.ignore_case)


def numeric_sort_value(line: str) -> float | None:
    trimmed = line.strip()
    if trimmed == "":
        return None

    try:
        value = float(trimmed)
    except ValueError:
        return None
    if not math.isfinite(value):
        return None
    return value


def dedupe_sorted_entries(entries: list[SortEntry], options: SortOptions) -> list[str]:
    output: list[str] = []
    group_start = 0

    while group_start < len(entries):
        best_entry = entries[group_start]
        group_end = group_start + 1

        while group_end < len(entries) and sort_lines_equivalent(entries[group_start].line, entries[group_end].line, options):
            if entries[group_end].index < best_entry.index:
                best_entry = entries[group_end]
            group_end += 1

        output.append(best_entry.line)
        group_start = group_end

    return output


def sort_lines_equivalent(left: str, right: str, options: SortOptions) -> bool:
    if options.version:
        return compare_version_sort_lines(left, right, options.ignore_case) == 0

    if not options.numeric:
        return compare_text_sort_lines(left, right, options.ignore_case) == 0

    left_number = numeric_sort_value(left)
    right_number = numeric_sort_value(right)
    if left_number is not None and right_number is not None:
        return left_number == right_number
    if left_number is not None or right_number is not None:
        return False
    return compare_text_sort_lines(left, right, options.ignore_case) == 0


def uniq_key(line: str, ignore_case: bool) -> str:
    return fold_ascii_case_text(line) if ignore_case else line


def render_uniq_line(line: str, count: int, include_count: bool) -> str:
    return f"{format_count_field(count)} {line}" if include_count else line


def should_include_uniq_group(count: int, options: UniqOptions) -> bool:
    if options.duplicates_only and options.unique_only:
        return False
    if options.duplicates_only:
        return count > 1
    if options.unique_only:
        return count == 1
    return True


def count_line_breaks(text: str) -> int:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    return normalized.count("\n")


def split_line_chunks(text: str) -> list[str]:
    if text == "":
        return []
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    return re.findall(r"[^\n]*\n|[^\n]+", normalized)


def count_words(text: str) -> int:
    matches = re.findall(r"\S+", text)
    return len(matches)


def compare_text_sort_lines(left: str, right: str, ignore_case: bool) -> int:
    return compare_c_locale_text(left, right, ignore_case)


def compare_version_sort_lines(left: str, right: str, ignore_case: bool) -> int:
    left_tokens = version_tokens(left)
    right_tokens = version_tokens(right)
    limit = min(len(left_tokens), len(right_tokens))

    for index in range(limit):
        left_token = left_tokens[index]
        right_token = right_tokens[index]
        if left_token == right_token:
            continue

        left_is_digit = is_ascii_digit_token(left_token)
        right_is_digit = is_ascii_digit_token(right_token)
        if left_is_digit and right_is_digit:
            return compare_version_number_tokens(left_token, right_token)
        return compare_c_locale_text(left_token, right_token, ignore_case)

    if len(left_tokens) < len(right_tokens):
        return -1
    if len(left_tokens) > len(right_tokens):
        return 1
    return 0


def version_tokens(value: str) -> list[str]:
    return _VERSION_TOKEN_PATTERN.findall(value)


def is_ascii_digit_token(value: str) -> bool:
    if value == "":
        return False
    code = ord(value[0])
    return _ASCII_DIGIT_0 <= code <= _ASCII_DIGIT_9


def compare_version_number_tokens(left: str, right: str) -> int:
    left_trimmed = trim_version_leading_zeros(left)
    right_trimmed = trim_version_leading_zeros(right)
    if len(left_trimmed) != len(right_trimmed):
        return -1 if len(left_trimmed) < len(right_trimmed) else 1
    if left_trimmed < right_trimmed:
        return -1
    if left_trimmed > right_trimmed:
        return 1
    if len(left) != len(right):
        return -1 if len(left) > len(right) else 1
    return 0


def trim_version_leading_zeros(value: str) -> str:
    index = 0
    while index < len(value) - 1 and ord(value[index]) == _ASCII_DIGIT_0:
        index += 1
    return value[index:]




def select_wc_fields(options: WcOptions, line_count: int, word_count: int, byte_count: int) -> list[int]:
    fields = [
        {"enabled": options.lines, "value": line_count},
        {"enabled": options.words, "value": word_count},
        {"enabled": options.bytes, "value": byte_count},
    ]
    selected = [field["value"] for field in fields if field["enabled"]]
    if not selected:
        return [line_count, word_count, byte_count]
    return selected


def render_wc_output(options: WcOptions, counts: dict[str, int], ctx: CommandContext) -> str:
    selected_counts = select_wc_fields(
        options,
        counts["line_count"],
        counts["word_count"],
        counts["byte_count"],
    )
    rendered_counts = render_wc_counts(selected_counts, options.file_path is not None)
    if options.file_path is None:
        return rendered_counts
    return f"{rendered_counts} {ctx.vfs.normalize(options.file_path)}"


def render_wc_counts(counts: list[int], has_file_path: bool) -> str:
    if len(counts) <= 1:
        return str(counts[0] if counts else 0)

    field_width = longest_count_width(counts) if has_file_path else 7
    return " ".join(str(value).rjust(field_width, " ") for value in counts)


def longest_count_width(counts: list[int]) -> int:
    width = 1
    for value in counts:
        width = max(width, len(str(value)))
    return width


def parse_slice_count_value(value: str) -> int | None:
    try:
        parsed = int(value, 10)
    except ValueError:
        return None
    if parsed < 0:
        return None
    return parsed


def render_slice_bytes(output: bytes) -> CommandResult:
    return ok_bytes(output, "application/octet-stream" if looks_binary(output) else "text/plain")


def text_slice_usage(command_name: str) -> str:
    return HEAD_USAGE if command_name == "head" else TAIL_USAGE


def format_count_field(value: int) -> str:
    return str(value).rjust(7, " ")


text_commands = [echo, grep, head, tail, sort, sed, tr, uniq, wc]
