from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import replace
from typing import Any

from .types import MemoryItem
from .utils import tokenize_for_search


class SimpleMemory:
    def __init__(self, *, _now_ms: Callable[[], int] | None = None) -> None:
        self._items: list[MemoryItem] = []
        self._next_id = 1
        self._now_ms = _now_ms or _default_now_ms

    def store(self, text: str, metadata: dict[str, Any] | None = None) -> MemoryItem:
        item = MemoryItem(
            id=self._next_id,
            text=text,
            created_epoch_ms=self._now_ms(),
            metadata=dict(metadata or {}),
        )
        self._next_id += 1
        self._items.append(item)
        return item

    def recent(self, limit: int = 10) -> list[MemoryItem]:
        return list(reversed(self._items[-limit:]))

    def search(self, query: str, limit: int = 10) -> list[MemoryItem]:
        query_tokens = tokenize_for_search(query)
        if not query_tokens:
            return self.recent(limit)

        scored: list[tuple[int, MemoryItem]] = []
        for item in self._items:
            item_tokens = tokenize_for_search(item.text)
            overlap = 0
            for token in query_tokens:
                if token in item_tokens:
                    overlap += 1
            if overlap > 0:
                scored.append((overlap, item))

        scored.sort(key=_search_sort_key)
        return [item for _, item in scored[:limit]]


def _default_now_ms() -> int:
    return int(time.time() * 1000)


def _search_sort_key(entry: tuple[int, MemoryItem]) -> tuple[int, int]:
    score, item = entry
    return (-score, -item.created_epoch_ms)
