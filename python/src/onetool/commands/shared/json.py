from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from ...execution_policy import format_materialized_limit_message
from ...types import CommandResult, err, ok, ok_bytes
from ..core import CommandContext
from .io import read_text_from_file_or_stdin


@dataclass(frozen=True, slots=True)
class JsonInputResult:
    value: Any = None
    error: CommandResult | None = None


async def load_json(
    ctx: CommandContext,
    file_path: str | None,
    stdin: bytes,
    command_name: str,
) -> JsonInputResult:
    loaded = await read_text_from_file_or_stdin(ctx, file_path, stdin, command_name)
    if loaded.error is not None:
        return JsonInputResult(error=loaded.error)
    source_text = loaded.text or ""
    try:
        return JsonInputResult(value=json.loads(source_text))
    except json.JSONDecodeError as caught:
        message = _format_json_decode_error(source_text, caught)
        return JsonInputResult(error=err(f"{command_name}: invalid JSON: {message}"))
    except Exception as caught:  # pragma: no cover - json provides many exception subclasses
        return JsonInputResult(error=err(f"{command_name}: invalid JSON: {caught}"))


def extract_json_path(value: Any, path_expression: str) -> Any:
    if path_expression == "":
        return value

    tokens: list[str | int] = []
    for segment in path_expression.split("."):
        if segment == "":
            continue
        cursor = 0
        while cursor < len(segment):
            if segment[cursor] == "[":
                end = segment.find("]", cursor)
                if end == -1:
                    raise ValueError(f"malformed path segment: {segment}")
                tokens.append(int(segment[cursor + 1 : end], 10))
                cursor = end + 1
                continue

            end = cursor
            while end < len(segment) and segment[end] != "[":
                end += 1
            tokens.append(segment[cursor:end])
            cursor = end

    current: Any = value
    for token in tokens:
        if isinstance(token, int):
            if not isinstance(current, list):
                raise KeyError(str(token))
            current = current[token]
            continue

        if not isinstance(current, dict) or token not in current:
            raise KeyError(token)
        current = current[token]

    return current


def render_fetch_payload(
    payload: Any,
    content_type: str,
    *,
    command_name: str = "fetch",
    subject: str = "resource",
    max_materialized_bytes: int | None = None,
) -> CommandResult:
    if isinstance(payload, bytes):
        limit_error = _materialized_payload_limit_error(
            command_name,
            subject,
            len(payload),
            max_materialized_bytes,
        )
        if limit_error is not None:
            return limit_error
        return ok_bytes(payload, content_type)

    if isinstance(payload, bytearray):
        data = bytes(payload)
        limit_error = _materialized_payload_limit_error(
            command_name,
            subject,
            len(data),
            max_materialized_bytes,
        )
        if limit_error is not None:
            return limit_error
        return ok_bytes(data, content_type)

    if isinstance(payload, (dict, list)):
        rendered = json.dumps(payload, indent=2)
        limit_error = _materialized_payload_limit_error(
            command_name,
            subject,
            len(rendered.encode("utf-8")),
            max_materialized_bytes,
        )
        if limit_error is not None:
            return limit_error
        return ok(rendered, content_type="application/json")

    rendered = "null" if payload is None else str(payload)
    limit_error = _materialized_payload_limit_error(
        command_name,
        subject,
        len(rendered.encode("utf-8")),
        max_materialized_bytes,
    )
    if limit_error is not None:
        return limit_error
    return ok(rendered, content_type=content_type)


def _materialized_payload_limit_error(
    command_name: str,
    subject: str,
    actual_bytes: int,
    max_materialized_bytes: int | None,
) -> CommandResult | None:
    if max_materialized_bytes is None or actual_bytes <= max_materialized_bytes:
        return None
    return err(
        format_materialized_limit_message(
            command_name,
            subject,
            actual_bytes,
            max_materialized_bytes,
        )
    )


def _format_json_decode_error(source_text: str, caught: json.JSONDecodeError) -> str:
    location = f"position {caught.pos} (line {caught.lineno} column {caught.colno})"

    if caught.msg == "Expecting property name enclosed in double quotes":
        return _format_property_name_error(source_text, location, caught.pos)

    if caught.msg == "Expecting ':' delimiter":
        return f"Expected ':' after property name in JSON at {location}"

    if caught.msg == "Expecting ',' delimiter":
        return f"Expected ',' or '}}' after property value in JSON at {location}"

    if caught.msg == "Expecting value":
        return _format_unexpected_token_error(source_text, caught.pos)

    return str(caught)


def _format_property_name_error(source_text: str, location: str, position: int) -> str:
    previous_char = _previous_non_whitespace_char(source_text, position)
    if previous_char == ",":
        return f"Expected double-quoted property name in JSON at {location}"
    return f"Expected property name or '}}' in JSON at {location}"


def _format_unexpected_token_error(source_text: str, position: int) -> str:
    if position >= len(source_text):
        return "Unexpected end of JSON input"
    return f"Unexpected token {_quote_js_char(source_text[position])}, {json.dumps(source_text)} is not valid JSON"


def _previous_non_whitespace_char(source_text: str, position: int) -> str | None:
    index = position - 1
    while index >= 0:
        char = source_text[index]
        if not char.isspace():
            return char
        index -= 1
    return None


def _quote_js_char(char: str) -> str:
    escaped = char.replace("\\", "\\\\").replace("'", "\\'")
    return f"'{escaped}'"
