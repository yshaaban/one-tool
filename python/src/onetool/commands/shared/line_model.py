from __future__ import annotations

from dataclasses import dataclass

LINE_FEED = 10


@dataclass(frozen=True, slots=True)
class ByteLine:
    bytes: bytes
    text: str


@dataclass(frozen=True, slots=True)
class ByteLineModel:
    lines: tuple[ByteLine, ...]
    ends_with_newline: bool
    byte_length: int


def create_byte_line_model(data: bytes) -> ByteLineModel:
    lines: list[ByteLine] = []
    line_start = 0

    for index, value in enumerate(data):
        if value != LINE_FEED:
            continue

        line_bytes = data[line_start:index]
        lines.append(ByteLine(bytes=line_bytes, text=decode_c_locale_text(line_bytes)))
        line_start = index + 1

    ends_with_newline = len(data) > 0 and data[-1] == LINE_FEED
    if line_start < len(data):
        line_bytes = data[line_start:]
        lines.append(ByteLine(bytes=line_bytes, text=decode_c_locale_text(line_bytes)))

    return ByteLineModel(
        lines=tuple(lines),
        ends_with_newline=ends_with_newline,
        byte_length=len(data),
    )


def decode_c_locale_text(data: bytes) -> str:
    return data.decode("latin1")


def encode_c_locale_text(text: str) -> bytes:
    return bytes(ord(char) & 0xFF for char in text)
