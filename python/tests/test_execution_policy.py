from __future__ import annotations

import pytest

from onetool.execution_policy import (
    AgentCLIExecutionPolicy,
    check_materialized_byte_limit,
    format_materialized_limit_message,
    resolve_execution_policy,
)


def test_resolve_execution_policy_returns_empty_policy_by_default() -> None:
    policy = resolve_execution_policy()
    assert policy.max_materialized_bytes is None


def test_resolve_execution_policy_validates_limits() -> None:
    with pytest.raises(ValueError, match="executionPolicy.maxMaterializedBytes must be a non-negative integer"):
        resolve_execution_policy(AgentCLIExecutionPolicy(max_materialized_bytes=-1))


def test_check_materialized_byte_limit_reports_over_limit() -> None:
    policy = resolve_execution_policy(AgentCLIExecutionPolicy(max_materialized_bytes=3))
    limit = check_materialized_byte_limit(policy, 5)

    assert limit is not None
    assert limit.limit == 3
    assert limit.actual == 5


def test_check_materialized_byte_limit_returns_none_when_within_limit() -> None:
    policy = resolve_execution_policy(AgentCLIExecutionPolicy(max_materialized_bytes=3))
    assert check_materialized_byte_limit(policy, 3) is None


def test_format_materialized_limit_message_matches_typescript_wording() -> None:
    message = format_materialized_limit_message("cat", "/notes/todo.txt", 2048, 1024)
    assert message == "cat: input exceeds max materialized size (2.0KB > 1.0KB): /notes/todo.txt"
