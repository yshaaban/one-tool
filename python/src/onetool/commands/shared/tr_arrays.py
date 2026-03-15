from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class TrProgram:
    delete_enabled: bool
    delete_set: frozenset[int]
    squeeze_set: frozenset[int]
    translate: dict[int, int] | None

    def run(self, input_data: bytes) -> bytes:
        output = bytearray()
        previous_output: int | None = None

        for byte in input_data:
            if self.delete_enabled and byte in self.delete_set:
                continue

            translated = self.translate.get(byte, byte) if self.translate is not None else byte
            if translated in self.squeeze_set and previous_output == translated:
                continue

            output.append(translated)
            previous_output = translated

        return bytes(output)


def compile_tr_program(args: list[str]) -> tuple[TrProgram | None, str | None]:
    parsed, error_text = _parse_tr_arguments(args)
    if error_text is not None:
        return (None, error_text)
    assert parsed is not None

    set1, classes1, error_text = _expand_tr_string(parsed["string1"], "string1")
    if error_text is not None:
        return (None, error_text)

    has_translation = not parsed["delete"] and parsed["string2"] is not None
    if not has_translation and not parsed["delete"] and not parsed["squeeze"]:
        return (None, "missing operand. Usage: tr [OPTION]... STRING1 [STRING2]")
    if parsed["delete"] and not parsed["squeeze"] and parsed["string2"] is not None:
        return (
            None,
            "extra operand. Only one string may be given when deleting without squeezing repeats. "
            "Usage: tr [OPTION]... STRING1 [STRING2]",
        )

    if parsed["complement"]:
        set1 = [value for value in range(256) if value not in set(set1)]

    delete_set = frozenset(set1)
    squeeze_set: frozenset[int] = frozenset()
    translate: dict[int, int] | None = None

    if has_translation:
        string2 = parsed["string2"] or ""
        set2, classes2, error_text = _expand_tr_string(string2, "string2")
        if error_text is not None:
            return (None, error_text)

        validation_error = _validate_string2_classes(classes1, classes2)
        if validation_error is not None:
            return (None, validation_error)

        if parsed["truncate_set1"] and len(set2) < len(set1):
            set1 = set1[: len(set2)]
        elif len(set2) < len(set1):
            if not set2:
                return (None, "when not truncating set1, string2 must be non-empty")
            fill_byte = set2[-1]
            set2 = [*set2, *([fill_byte] * (len(set1) - len(set2)))]

        translate = {left: right for left, right in zip(set1, set2)}
        if parsed["squeeze"]:
            squeeze_set = frozenset(set2)
    elif parsed["squeeze"]:
        squeeze_spec = parsed["string2"] if parsed["string2"] is not None else parsed["string1"]
        squeeze_bytes, _classes, error_text = _expand_tr_string(squeeze_spec, "string2")
        if error_text is not None:
            return (None, error_text)
        squeeze_set = frozenset(squeeze_bytes)

    return (
        TrProgram(
            delete_enabled=bool(parsed["delete"]),
            delete_set=delete_set,
            squeeze_set=squeeze_set,
            translate=translate,
        ),
        None,
    )


def _parse_tr_arguments(args: list[str]) -> tuple[dict[str, object] | None, str | None]:
    complement = False
    delete = False
    squeeze = False
    truncate_set1 = False
    parsing_options = True
    operands: list[str] = []

    for arg in args:
        if parsing_options and arg == "--":
            parsing_options = False
            continue

        if parsing_options and arg.startswith("-") and len(arg) > 1:
            for flag in arg[1:]:
                if flag in {"c", "C"}:
                    complement = True
                elif flag == "d":
                    delete = True
                elif flag == "s":
                    squeeze = True
                elif flag == "t":
                    truncate_set1 = True
                else:
                    return (None, f"unknown option: -{flag}. Usage: tr [OPTION]... STRING1 [STRING2]")
            continue

        operands.append(arg)
        parsing_options = False

    if not operands:
        return (None, "missing operand. Usage: tr [OPTION]... STRING1 [STRING2]")
    if len(operands) > 2:
        return (None, "too many operands. Usage: tr [OPTION]... STRING1 [STRING2]")

    return (
        {
            "complement": complement,
            "delete": delete,
            "squeeze": squeeze,
            "truncate_set1": truncate_set1,
            "string1": operands[0],
            "string2": operands[1] if len(operands) > 1 else None,
        },
        None,
    )


def _expand_tr_string(value: str, mode: str) -> tuple[list[int], list[str], str | None]:
    result: list[int] = []
    classes: list[str] = []
    index = 0

    while index < len(value):
        class_match = _CHARACTER_CLASS_PATTERN.match(value, index)
        if class_match is not None:
            class_name = class_match.group(1)
            if class_name not in _CHARACTER_CLASSES:
                return ([], [], f"unsupported character class: [:{class_name}:]")
            result.extend(_CHARACTER_CLASSES[class_name])
            classes.append(class_name)
            index = class_match.end()
            continue

        byte_value, next_index, error_text = _parse_tr_byte(value, index)
        if error_text is not None:
            return ([], [], error_text)

        if next_index < len(value) - 1 and value[next_index] == "-":
            range_end, range_next_index, error_text = _parse_tr_byte(value, next_index + 1)
            if error_text is not None:
                return ([], [], error_text)
            if byte_value > range_end:
                return ([], [], "invalid descending range")
            result.extend(range(byte_value, range_end + 1))
            index = range_next_index
            continue

        result.append(byte_value)
        index = next_index

    return (result, classes, None)


def _parse_tr_byte(value: str, index: int) -> tuple[int, int, str | None]:
    if value[index] == "\\":
        if index + 1 >= len(value):
            return (0, len(value), None)
        escape = value[index + 1]
        mapping = {
            "a": 0x07,
            "b": 0x08,
            "f": 0x0C,
            "n": 0x0A,
            "r": 0x0D,
            "t": 0x09,
            "v": 0x0B,
            "\\": 0x5C,
        }
        if escape in mapping:
            return (mapping[escape], index + 2, None)
        if escape.isdigit():
            octal_match = re.match(r"[0-7]{1,3}", value[index + 1 :])
            assert octal_match is not None
            return (int(octal_match.group(0), 8) & 0xFF, index + 1 + len(octal_match.group(0)), None)
        return (ord(escape) & 0xFF, index + 2, None)

    codepoint = ord(value[index])
    if codepoint > 0xFF:
        return (0, index + 1, f"unsupported non-byte character: {value[index]}")
    return (codepoint, index + 1, None)


def _validate_string2_classes(classes1: list[str], classes2: list[str]) -> str | None:
    interesting = {"lower", "upper"}
    left = [value for value in classes1 if value in interesting]
    right = [value for value in classes2 if value in interesting]
    if not left and not right:
        return None
    if len(left) != len(right):
        return "misaligned [:upper:] and/or [:lower:] construct"
    for left_name, right_name in zip(left, right):
        if {left_name, right_name} != {"lower", "upper"}:
            return "misaligned [:upper:] and/or [:lower:] construct"
    return None


_CHARACTER_CLASS_PATTERN = re.compile(r"\[:([a-z]+):\]")
_LOWER = list(range(ord("a"), ord("z") + 1))
_UPPER = list(range(ord("A"), ord("Z") + 1))
_DIGIT = list(range(ord("0"), ord("9") + 1))
_SPACE = [9, 10, 11, 12, 13, 32]
_CHARACTER_CLASSES: dict[str, list[int]] = {
    "alnum": [*_LOWER, *_UPPER, *_DIGIT],
    "alpha": [*_LOWER, *_UPPER],
    "blank": [9, 32],
    "cntrl": list(range(0, 32)) + [127],
    "digit": _DIGIT,
    "graph": list(range(33, 127)),
    "lower": _LOWER,
    "print": list(range(32, 127)),
    "punct": [value for value in range(33, 127) if chr(value).isalnum() is False and chr(value) != " "],
    "space": _SPACE,
    "upper": _UPPER,
    "xdigit": [*range(ord("0"), ord("9") + 1), *range(ord("A"), ord("F") + 1), *range(ord("a"), ord("f") + 1)],
}
