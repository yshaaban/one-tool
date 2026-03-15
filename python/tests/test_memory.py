from __future__ import annotations

from onetool.memory import SimpleMemory


def test_simple_memory_store_returns_items_with_incrementing_ids_and_timestamps() -> None:
    clock = iter([1700000000001, 1700000000002])
    memory = SimpleMemory(_now_ms=lambda: next(clock))

    first = memory.store("first note")
    second = memory.store("second note", {"source": "demo"})

    assert first.id == 1
    assert first.text == "first note"
    assert first.created_epoch_ms == 1700000000001
    assert first.metadata == {}

    assert second.id == 2
    assert second.text == "second note"
    assert second.created_epoch_ms == 1700000000002
    assert second.metadata == {"source": "demo"}


def test_simple_memory_recent_returns_newest_items_first() -> None:
    clock = iter([1, 2, 3])
    memory = SimpleMemory(_now_ms=lambda: next(clock))
    memory.store("one")
    memory.store("two")
    memory.store("three")

    assert [item.text for item in memory.recent(2)] == ["three", "two"]


def test_simple_memory_search_ranks_by_overlap_and_recency() -> None:
    clock = iter([1, 2, 3])
    memory = SimpleMemory(_now_ms=lambda: next(clock))
    memory.store("acme payment timeout")
    memory.store("acme timeout")
    memory.store("payment timeout")

    assert [item.text for item in memory.search("acme payment timeout")] == [
        "acme payment timeout",
        "payment timeout",
        "acme timeout",
    ]


def test_simple_memory_search_falls_back_to_recent_for_empty_queries() -> None:
    clock = iter([1, 2])
    memory = SimpleMemory(_now_ms=lambda: next(clock))
    memory.store("one")
    memory.store("two")

    assert [item.text for item in memory.search("")] == ["two", "one"]


def test_simple_memory_search_returns_empty_list_when_nothing_matches() -> None:
    memory = SimpleMemory(_now_ms=lambda: 1)
    memory.store("acme renewal")
    assert memory.search("vat invoice") == []
