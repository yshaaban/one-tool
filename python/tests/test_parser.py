from __future__ import annotations

from dataclasses import asdict

import pytest

from conftest import load_jsonl
from onetool.parser import ParseError, parse_command_line, tokenize_command_line


def test_tokenizer_matches_golden_snapshots() -> None:
    for record in load_jsonl("parser/tokenizer.jsonl"):
        assert tokenize_command_line(record["input"]) == record["tokens"]


def test_parser_matches_golden_snapshots() -> None:
    for record in load_jsonl("parser/ast.jsonl"):
        actual = [_chain_node_to_snapshot(node) for node in parse_command_line(record["input"])]
        assert actual == record["ast"]


def test_parser_errors_match_golden_snapshots() -> None:
    for record in load_jsonl("parser/errors.jsonl"):
        with pytest.raises(ParseError) as caught:
            if record["stage"] == "tokenize":
                tokenize_command_line(record["input"])
            else:
                parse_command_line(record["input"])
        assert str(caught.value) == record["error"]


def _chain_node_to_snapshot(node: object) -> dict[str, object]:
    raw = asdict(node)
    return {
        "relationFromPrevious": raw["relation_from_previous"],
        "pipeline": raw["pipeline"],
    }
