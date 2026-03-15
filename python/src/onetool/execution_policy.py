from __future__ import annotations

from dataclasses import dataclass

from .utils import format_size


@dataclass(frozen=True, slots=True)
class AgentCLIExecutionPolicy:
    max_materialized_bytes: int | None = None


ResolvedAgentCLIExecutionPolicy = AgentCLIExecutionPolicy


@dataclass(frozen=True, slots=True)
class MaterializedByteLimit:
    limit: int
    actual: int


EMPTY_EXECUTION_POLICY = AgentCLIExecutionPolicy()


def resolve_execution_policy(
    policy: AgentCLIExecutionPolicy | None = None,
) -> ResolvedAgentCLIExecutionPolicy:
    if policy is None:
        return EMPTY_EXECUTION_POLICY

    _validate_limit("executionPolicy.maxMaterializedBytes", policy.max_materialized_bytes)
    return AgentCLIExecutionPolicy(max_materialized_bytes=policy.max_materialized_bytes)


def check_materialized_byte_limit(
    policy: ResolvedAgentCLIExecutionPolicy,
    actual: int,
) -> MaterializedByteLimit | None:
    limit = policy.max_materialized_bytes
    if limit is None or actual <= limit:
        return None
    return MaterializedByteLimit(limit=limit, actual=actual)


def format_materialized_limit_message(
    command_name: str,
    subject: str,
    actual: int,
    limit: int,
) -> str:
    return (
        f"{command_name}: input exceeds max materialized size "
        f"({format_size(actual)} > {format_size(limit)}): {subject}"
    )


def _validate_limit(label: str, value: int | None) -> None:
    if value is None:
        return
    if not isinstance(value, int) or value < 0:
        raise ValueError(f"{label} must be a non-negative integer")
