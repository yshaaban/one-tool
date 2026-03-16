from __future__ import annotations

import re

_ASCII_LOWERCASE_A = ord("a")
_ASCII_LOWERCASE_Z = ord("z")
_ASCII_UPPERCASE_A = ord("A")
_ASCII_UPPERCASE_Z = ord("Z")
_ASCII_CASE_OFFSET = 32
C_LOCALE_REGEX_FLAGS = re.MULTILINE | re.ASCII


def fold_ascii_case_text(text: str) -> str:
    changed = False
    chars: list[str] = []

    for char in text:
        code = ord(char)
        if _ASCII_LOWERCASE_A <= code <= _ASCII_LOWERCASE_Z:
            chars.append(chr(code - _ASCII_CASE_OFFSET))
            changed = True
            continue
        chars.append(char)

    if not changed:
        return text
    return "".join(chars)


def to_c_locale_sort_bytes(text: str, ignore_case: bool = False) -> bytes:
    encoded = text.encode("utf-8")
    if not ignore_case:
        return encoded

    folded = bytearray(encoded)
    changed = False
    for index, value in enumerate(folded):
        if _ASCII_LOWERCASE_A <= value <= _ASCII_LOWERCASE_Z:
            folded[index] = value - _ASCII_CASE_OFFSET
            changed = True

    if not changed:
        return encoded
    return bytes(folded)


def compare_c_locale_text(left: str, right: str, ignore_case: bool = False) -> int:
    left_bytes = to_c_locale_sort_bytes(left, ignore_case)
    right_bytes = to_c_locale_sort_bytes(right, ignore_case)
    limit = min(len(left_bytes), len(right_bytes))

    for index in range(limit):
        left_value = left_bytes[index]
        right_value = right_bytes[index]
        if left_value != right_value:
            return -1 if left_value < right_value else 1

    if len(left_bytes) < len(right_bytes):
        return -1
    if len(left_bytes) > len(right_bytes):
        return 1
    return 0


def build_c_locale_case_insensitive_regex_source(source: str) -> str:
    output: list[str] = []
    index = 0

    while index < len(source):
        char = source[index]
        if char == "\\":
            transformed, index = _transform_regex_escape(source, index, in_character_class=False)
            output.append(transformed)
            continue
        if char == "[":
            transformed, index = _transform_regex_character_class(source, index)
            output.append(transformed)
            continue

        output.append(_expand_ascii_regex_literal(char))
        index += 1

    return "".join(output)


def compile_c_locale_regex(
    source: str,
    *,
    ignore_case: bool = False,
    flags: int = C_LOCALE_REGEX_FLAGS,
) -> re.Pattern[str]:
    pattern = build_c_locale_case_insensitive_regex_source(source) if ignore_case else source
    return re.compile(pattern, flags)


def _transform_regex_escape(source: str, index: int, *, in_character_class: bool) -> tuple[str, int]:
    if index + 1 >= len(source):
        return (r"\\", len(source))

    unicode_escape = _read_regex_unicode_escape(source, index)
    if unicode_escape is not None:
        return unicode_escape

    hex_escape = _read_regex_hex_escape(source, index)
    if hex_escape is not None:
        return hex_escape

    control_escape = _read_regex_control_escape(source, index)
    if control_escape is not None:
        return control_escape

    named_backreference = _read_regex_named_backreference(source, index)
    if named_backreference is not None:
        return named_backreference

    next_char = source[index + 1]
    if (
        next_char.isdigit()
        or next_char in "bBdDsSwWfFnNrRtTvV0"
        or next_char in "^$\\.*+?()[]{}|/-"
    ):
        return (f"\\{next_char}", index + 2)

    if _is_ascii_letter(next_char):
        literal = (
            _expand_ascii_character_class_literal(next_char)
            if in_character_class
            else _expand_ascii_regex_literal(next_char)
        )
        return (literal, index + 2)

    return (f"\\{next_char}", index + 2)


def _transform_regex_character_class(source: str, index: int) -> tuple[str, int]:
    output = ["["]
    cursor = index + 1

    if cursor < len(source) and source[cursor] == "^":
        output.append("^")
        cursor += 1
    if cursor < len(source) and source[cursor] == "]":
        output.append("]")
        cursor += 1

    while cursor < len(source):
        char = source[cursor]
        if char == "]":
            output.append("]")
            return ("".join(output), cursor + 1)
        if char == "\\":
            transformed, cursor = _transform_regex_escape(source, cursor, in_character_class=True)
            output.append(transformed)
            continue

        if (
            cursor + 2 < len(source)
            and source[cursor + 1] == "-"
            and source[cursor + 2] != "]"
            and _is_ascii_letter(char)
            and _is_ascii_letter(source[cursor + 2])
        ):
            output.append(_expand_ascii_character_class_range(char, source[cursor + 2]))
            cursor += 3
            continue

        output.append(_expand_ascii_character_class_literal(char))
        cursor += 1

    return ("".join(output), len(source))


def _read_regex_unicode_escape(source: str, index: int) -> tuple[str, int] | None:
    if index + 1 >= len(source) or source[index + 1] != "u":
        return None

    if index + 2 < len(source) and source[index + 2] == "{":
        close_index = source.find("}", index + 3)
        if close_index == -1:
            return None
        return (source[index : close_index + 1], close_index + 1)

    literal = source[index : index + 6]
    if re.fullmatch(r"\\u[0-9A-Fa-f]{4}", literal) is None:
        return None
    return (literal, index + 6)


def _read_regex_hex_escape(source: str, index: int) -> tuple[str, int] | None:
    literal = source[index : index + 4]
    if re.fullmatch(r"\\x[0-9A-Fa-f]{2}", literal) is None:
        return None
    return (literal, index + 4)


def _read_regex_control_escape(source: str, index: int) -> tuple[str, int] | None:
    if index + 2 >= len(source) or source[index + 1] != "c":
        return None
    return (source[index : index + 3], index + 3)


def _read_regex_named_backreference(source: str, index: int) -> tuple[str, int] | None:
    if index + 2 >= len(source) or source[index + 1] != "k" or source[index + 2] != "<":
        return None
    close_index = source.find(">", index + 3)
    if close_index == -1:
        return None
    return (source[index : close_index + 1], close_index + 1)


def _expand_ascii_regex_literal(char: str) -> str:
    if not _is_ascii_letter(char):
        return char
    upper = char.upper()
    lower = char.lower()
    return f"[{upper}{lower}]"


def _expand_ascii_character_class_literal(char: str) -> str:
    if not _is_ascii_letter(char):
        return char
    upper = char.upper()
    lower = char.lower()
    if upper == lower:
        return char
    return f"{upper}{lower}"


def _expand_ascii_character_class_range(start: str, end: str) -> str:
    start_lower = start.lower()
    end_lower = end.lower()
    start_code = ord(start_lower)
    end_code = ord(end_lower)

    if (
        start_code < _ASCII_LOWERCASE_A
        or start_code > _ASCII_LOWERCASE_Z
        or end_code < _ASCII_LOWERCASE_A
        or end_code > _ASCII_LOWERCASE_Z
        or start_code > end_code
    ):
        return f"{_expand_ascii_character_class_literal(start)}-{_expand_ascii_character_class_literal(end)}"

    upper_start = chr(start_code - _ASCII_CASE_OFFSET)
    upper_end = chr(end_code - _ASCII_CASE_OFFSET)
    lower_start = chr(start_code)
    lower_end = chr(end_code)
    return f"{upper_start}-{upper_end}{lower_start}-{lower_end}"


def _is_ascii_letter(char: str) -> bool:
    if char == "":
        return False
    code = ord(char)
    return (_ASCII_LOWERCASE_A <= code <= _ASCII_LOWERCASE_Z) or (_ASCII_UPPERCASE_A <= code <= _ASCII_UPPERCASE_Z)
