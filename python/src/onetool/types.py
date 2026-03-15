from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Awaitable, Protocol, TypeVar

T = TypeVar("T")
MaybeAwaitable = T | Awaitable[T]


@dataclass(frozen=True, slots=True)
class CommandResult:
    stdout: bytes
    stderr: str
    exit_code: int
    content_type: str


def ok(text: str = "", *, content_type: str = "text/plain") -> CommandResult:
    return CommandResult(
        stdout=text.encode("utf-8"),
        stderr="",
        exit_code=0,
        content_type=content_type,
    )


def ok_bytes(data: bytes, content_type: str = "application/octet-stream") -> CommandResult:
    return CommandResult(
        stdout=bytes(data),
        stderr="",
        exit_code=0,
        content_type=content_type,
    )


def err(message: str, *, exit_code: int = 1) -> CommandResult:
    return CommandResult(
        stdout=b"",
        stderr=message,
        exit_code=exit_code,
        content_type="text/plain",
    )


@dataclass(frozen=True, slots=True)
class SearchHit:
    title: str
    snippet: str
    source: str | None = None


class SearchAdapter(Protocol):
    def search(self, query: str, limit: int | None = None) -> MaybeAwaitable[list[SearchHit]]:
        ...


@dataclass(frozen=True, slots=True)
class FetchResponse:
    content_type: str
    payload: Any


class FetchAdapter(Protocol):
    def fetch(self, resource: str) -> MaybeAwaitable[FetchResponse]:
        ...


@dataclass(slots=True)
class ToolAdapters:
    search: SearchAdapter | None = None
    fetch: FetchAdapter | None = None


@dataclass(frozen=True, slots=True)
class MemoryItem:
    id: int
    text: str
    created_epoch_ms: int
    metadata: dict[str, Any] = field(default_factory=dict)
