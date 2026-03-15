from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from ..runtime import AgentCLIOutputLimits, ToolDescriptionVariant
from .adapters import DemoSearchDocument

ScenarioCategory = Literal[
    "discovery",
    "composition",
    "files",
    "structured",
    "memory",
    "overflow",
    "binary",
    "safety",
    "long_horizon",
]
ScenarioPromptVariant = ToolDescriptionVariant


@dataclass(frozen=True, slots=True)
class OracleCommandSpec:
    command: str
    expected_exit_code: int | None = None


@dataclass(frozen=True, slots=True)
class WorldSpec:
    files: dict[str, str | bytes] | None = None
    search_docs: list[DemoSearchDocument] | None = None
    fetch_resources: dict[str, Any] | None = None
    memory: list[str] | None = None
    output_limits: AgentCLIOutputLimits | None = None


@dataclass(frozen=True, slots=True)
class TextAssertionSpec:
    exact: str | None = None
    contains: list[str] | None = None
    not_contains: list[str] | None = None
    regex: list[str] | None = None


@dataclass(frozen=True, slots=True)
class FileAssertionSpec(TextAssertionSpec):
    path: str = ""
    exists: bool | None = None


@dataclass(frozen=True, slots=True)
class MemoryAssertionSpec:
    contains: list[str] | None = None


@dataclass(frozen=True, slots=True)
class TraceStepAssertionSpec(TextAssertionSpec):
    index: int = 0
    exit_code: int | None = None


@dataclass(frozen=True, slots=True)
class TraceAssertionSpec:
    must_include: list[str] | None = None
    forbidden: list[str] | None = None
    max_calls: int | None = None
    steps: list[TraceStepAssertionSpec] | None = None


@dataclass(frozen=True, slots=True)
class AssertionSpec:
    final_answer: TextAssertionSpec | None = None
    files: list[FileAssertionSpec] | None = None
    memory: MemoryAssertionSpec | None = None
    trace: TraceAssertionSpec | None = None


@dataclass(frozen=True, slots=True)
class ScenarioSpec:
    id: str
    category: ScenarioCategory
    description: str
    prompt: str
    max_turns: int
    max_tool_calls: int
    world: WorldSpec
    assertions: AssertionSpec
    prompt_variant: ScenarioPromptVariant | None = None
    repeats: int | None = None
    oracle: list[str | OracleCommandSpec] = field(default_factory=list)
