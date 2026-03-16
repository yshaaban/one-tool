from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
from typing import Any

from ..c_locale import to_c_locale_sort_bytes
from ..types import FetchResponse, SearchHit
from ..utils import tokenize_for_search


@dataclass(frozen=True, slots=True)
class DemoSearchDocument:
    title: str
    body: str
    source: str


@dataclass(frozen=True, slots=True)
class _ScoredSearchHit:
    score: int
    hit: SearchHit


class DemoSearch:
    def __init__(self, docs: list[DemoSearchDocument]) -> None:
        self._docs = [DemoSearchDocument(doc.title, doc.body, doc.source) for doc in docs]

    async def search(self, query: str, limit: int = 10) -> list[SearchHit]:
        query_tokens = tokenize_for_search(query)
        scored: list[_ScoredSearchHit] = []

        for doc in self._docs:
            overlap = _count_token_overlap(query_tokens, f"{doc.title}\n{doc.body}")
            if overlap == 0:
                continue

            scored.append(
                _ScoredSearchHit(
                    score=overlap,
                    hit=SearchHit(
                        title=doc.title,
                        snippet=_truncate_snippet(doc.body),
                        source=doc.source,
                    ),
                )
            )

        scored.sort(key=lambda entry: (-entry.score, to_c_locale_sort_bytes(entry.hit.title)))
        return [entry.hit for entry in scored[:limit]]


class DemoFetch:
    def __init__(self, resources: dict[str, Any]) -> None:
        self._resources = {resource: _clone_demo_payload(payload) for resource, payload in resources.items()}

    async def fetch(self, resource: str) -> FetchResponse:
        if resource not in self._resources:
            raise ValueError(f"resource not found: {resource}")

        payload = _clone_demo_payload(self._resources[resource])
        if isinstance(payload, bytes):
            return FetchResponse(content_type="application/octet-stream", payload=payload)
        if isinstance(payload, str):
            return FetchResponse(content_type="text/plain", payload=payload)
        return FetchResponse(content_type="application/json", payload=payload)


def _count_token_overlap(query_tokens: set[str], text: str) -> int:
    tokens = tokenize_for_search(text)
    overlap = 0
    for token in query_tokens:
        if token in tokens:
            overlap += 1
    return overlap


def _truncate_snippet(body: str) -> str:
    snippet = " ".join(body.split())
    if len(snippet) <= 160:
        return snippet
    return f"{snippet[:157]}..."


def _clone_demo_payload(payload: Any) -> Any:
    if isinstance(payload, bytes):
        return bytes(payload)
    if isinstance(payload, bytearray):
        return bytes(payload)
    if payload is None or isinstance(payload, (str, int, float, bool)):
        return payload
    return deepcopy(payload)
