from __future__ import annotations

import math
import re
from collections.abc import Sequence
from typing import Any

from .vfs.path_utils import parent_of, posix_normalize

_SEARCH_TOKEN_PATTERN = re.compile(r"[a-z0-9_]+")
_NUMBER_PATTERN = re.compile(r"(?:\d+\.?\d*|\.\d+)\Z")


def error_message(caught: object) -> str:
    if isinstance(caught, BaseException):
        return str(caught)
    if isinstance(caught, str):
        return caught
    if isinstance(caught, dict):
        return "[object Object]"
    return str(caught)


def split_lines(text: str) -> list[str]:
    if text == "":
        return []
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = normalized.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    return lines


def format_duration(duration_ms: int | float) -> str:
    if duration_ms < 1000:
        return f"{duration_ms}ms"
    seconds = duration_ms / 1000
    if seconds < 60:
        return f"{seconds:.1f}s"
    minutes = math.floor(seconds / 60)
    remainder = seconds - (minutes * 60)
    return f"{minutes}m{remainder:.1f}s"


def format_size(size: int | float) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    value = float(size)
    for unit in units:
        if value < 1024 or unit == units[-1]:
            if unit == "B":
                return f"{round(value)}{unit}"
            return f"{value:.1f}{unit}"
        value /= 1024
    return f"{size}B"


def tokenize_for_search(text: str) -> set[str]:
    return set(_SEARCH_TOKEN_PATTERN.findall(text.lower()))


def looks_binary(data: bytes) -> bool:
    if len(data) == 0:
        return False
    if 0 in data:
        return True

    try:
        decoded = data.decode("utf-8", errors="strict")
    except UnicodeDecodeError:
        return True

    controls = 0
    for char in decoded:
        code = ord(char)
        if code < 32 and char not in {"\n", "\r", "\t"}:
            controls += 1

    return controls / max(len(decoded), 1) > 0.1


def parent_path(input_path: str) -> str:
    return parent_of(posix_normalize(input_path))


class _ArithmeticParser:
    def __init__(self, tokens: Sequence[tuple[str, object]]) -> None:
        self._tokens = tokens
        self._index = 0

    def parse(self) -> float:
        value = self._parse_add_sub()
        if self._peek() is not None:
            raise ValueError("unexpected trailing input")
        if not math.isfinite(value):
            raise ValueError("result is not finite")
        return value

    def _peek(self) -> tuple[str, object] | None:
        if self._index >= len(self._tokens):
            return None
        return self._tokens[self._index]

    def _consume(self) -> tuple[str, object]:
        token = self._peek()
        if token is None:
            raise ValueError("unexpected end of expression")
        self._index += 1
        return token

    def _match_operator(self, *operators: str) -> str | None:
        token = self._peek()
        if token is not None and token[0] == "operator" and token[1] in operators:
            self._index += 1
            return str(token[1])
        return None

    def _match_paren(self, value: str) -> bool:
        token = self._peek()
        if token is not None and token[0] == "paren" and token[1] == value:
            self._index += 1
            return True
        return False

    def _parse_add_sub(self) -> float:
        value = self._parse_mul_div()
        while True:
            operator = self._match_operator("+", "-")
            if operator is None:
                return value
            right = self._parse_mul_div()
            if operator == "+":
                value += right
            else:
                value -= right

    def _parse_mul_div(self) -> float:
        value = self._parse_unary()
        while True:
            operator = self._match_operator("*", "/", "//", "%")
            if operator is None:
                return value
            right = self._parse_unary()
            try:
                if operator == "*":
                    value *= right
                elif operator == "/":
                    value /= right
                elif operator == "//":
                    value = math.floor(value / right)
                else:
                    value = math.fmod(value, right)
            except ZeroDivisionError as caught:
                raise ValueError("result is not finite") from caught
            if not math.isfinite(value):
                raise ValueError("result is not finite")

    def _parse_unary(self) -> float:
        operator = self._match_operator("+", "-")
        if operator == "+":
            return +self._parse_unary()
        if operator == "-":
            return -self._parse_unary()
        return self._parse_power()

    def _parse_power(self) -> float:
        value = self._parse_primary()
        operator = self._match_operator("**")
        if operator == "**":
            right = self._parse_unary()
            value = value**right
            if not math.isfinite(value):
                raise ValueError("result is not finite")
        return value

    def _parse_primary(self) -> float:
        if self._match_paren("("):
            value = self._parse_add_sub()
            if not self._match_paren(")"):
                raise ValueError("missing closing ')'")
            return value

        token = self._consume()
        if token[0] != "number":
            raise ValueError("expected number or parenthesized expression")
        return float(token[1])


def safe_eval_arithmetic(expression: str) -> float:
    tokens = _tokenize_arithmetic(expression)
    if not tokens:
        raise ValueError("empty expression")
    return _ArithmeticParser(tokens).parse()


def is_plain_object(value: object) -> bool:
    return isinstance(value, dict)


def _tokenize_arithmetic(expression: str) -> list[tuple[str, object]]:
    tokens: list[tuple[str, object]] = []
    index = 0

    while index < len(expression):
        char = expression[index]

        if char.isspace():
            index += 1
            continue

        if char.isdigit() or char == ".":
            end = index + 1
            while end < len(expression) and (expression[end].isdigit() or expression[end] == "."):
                end += 1
            literal = expression[index:end]
            if _NUMBER_PATTERN.fullmatch(literal) is None:
                raise ValueError(f"invalid number: {literal}")
            tokens.append(("number", float(literal)))
            index = end
            continue

        if char in {"(", ")"}:
            tokens.append(("paren", char))
            index += 1
            continue

        if char == "*" and _peek_char(expression, index + 1) == "*":
            tokens.append(("operator", "**"))
            index += 2
            continue

        if char == "/" and _peek_char(expression, index + 1) == "/":
            tokens.append(("operator", "//"))
            index += 2
            continue

        if char in {"+", "-", "*", "/", "%"}:
            tokens.append(("operator", char))
            index += 1
            continue

        raise ValueError(f"unsupported character: {char}")

    return tokens


def _peek_char(value: str, index: int) -> str | None:
    if index >= len(value):
        return None
    return value[index]
