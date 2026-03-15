from __future__ import annotations

import base64

import pytest

from conftest import load_jsonl
from onetool.utils import (
    error_message,
    format_duration,
    format_size,
    is_plain_object,
    looks_binary,
    parent_path,
    safe_eval_arithmetic,
    split_lines,
    tokenize_for_search,
)


def test_safe_eval_arithmetic_matches_golden_snapshots() -> None:
    for record in load_jsonl("utils/arithmetic.jsonl"):
        if "error" in record:
            with pytest.raises(ValueError) as caught:
                safe_eval_arithmetic(record["expression"])
            assert str(caught.value) == record["error"]
        else:
            assert safe_eval_arithmetic(record["expression"]) == record["result"]


def test_format_helpers_match_golden_snapshots() -> None:
    for record in load_jsonl("utils/format.jsonl"):
        if record["kind"] == "duration":
            assert format_duration(record["input"]) == record["output"]
        else:
            assert format_size(record["input"]) == record["output"]


def test_looks_binary_matches_golden_snapshots() -> None:
    for record in load_jsonl("utils/binary-detection.jsonl"):
        data = base64.b64decode(record["data_b64"])
        assert looks_binary(data) is record["looksBinary"]


def test_split_lines_normalizes_newlines_and_drops_trailing_empty_line() -> None:
    assert split_lines("a\r\nb\rc\n") == ["a", "b", "c"]
    assert split_lines("") == []


def test_search_tokenization_and_parent_path_match_typescript_behavior() -> None:
    assert tokenize_for_search("Acme_REFUND timeout 2025!") == {"acme_refund", "timeout", "2025"}
    assert parent_path("/notes/../reports/q1.txt") == "/reports"


def test_error_message_and_plain_object_helpers_match_runtime_expectations() -> None:
    assert error_message(ValueError("boom")) == "boom"
    assert error_message({"oops": True}) == "[object Object]"
    assert is_plain_object({"x": 1}) is True
    assert is_plain_object([]) is False
