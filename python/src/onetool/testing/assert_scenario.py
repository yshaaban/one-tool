from __future__ import annotations

import re
from dataclasses import dataclass

from ..runtime import AgentCLI
from ..utils import error_message
from .oracle_runner import OracleTrace
from .scenario import (
    AssertionSpec,
    FileAssertionSpec,
    ScenarioSpec,
    TextAssertionSpec,
    TraceStepAssertionSpec,
)


@dataclass(frozen=True, slots=True)
class AssertionResult:
    passed: bool
    failures: list[str]


async def assert_scenario(
    scenario: ScenarioSpec,
    trace: OracleTrace,
    runtime: AgentCLI,
) -> AssertionResult:
    failures: list[str] = []

    if len(trace.steps) > scenario.max_tool_calls:
        failures.append(
            f"{scenario.id}: oracle used {len(trace.steps)} tool calls, "
            f"exceeding max_tool_calls={scenario.max_tool_calls}"
        )

    _assert_expected_exit_codes(scenario, trace, failures)
    _assert_final_answer(scenario.id, scenario.assertions, trace, failures)
    await _assert_files(scenario.id, scenario.assertions, runtime, failures)
    _assert_memory(scenario.id, scenario.assertions, runtime, failures)
    _assert_trace(scenario.id, scenario.assertions, trace, failures)

    return AssertionResult(passed=not failures, failures=failures)


def _assert_expected_exit_codes(
    scenario: ScenarioSpec,
    trace: OracleTrace,
    failures: list[str],
) -> None:
    for index, step in enumerate(trace.steps):
        if step.exit_code != step.expected_exit_code:
            failures.append(
                f"{scenario.id}: oracle step {index} exited {step.exit_code}, "
                f"expected {step.expected_exit_code}: {step.command}"
            )


def _assert_final_answer(
    scenario_id: str,
    assertions: AssertionSpec,
    trace: OracleTrace,
    failures: list[str],
) -> None:
    if assertions.final_answer is None:
        return
    _assert_text_assertions(trace.final_body, assertions.final_answer, f"{scenario_id}: final output", failures)


async def _assert_files(
    scenario_id: str,
    assertions: AssertionSpec,
    runtime: AgentCLI,
    failures: list[str],
) -> None:
    if assertions.files is None:
        return

    for file_assertion in assertions.files:
        await _assert_file(scenario_id, file_assertion, runtime, failures)


async def _assert_file(
    scenario_id: str,
    file_assertion: FileAssertionSpec,
    runtime: AgentCLI,
    failures: list[str],
) -> None:
    normalized_path = runtime.ctx.vfs.normalize(file_assertion.path)
    exists = await runtime.ctx.vfs.exists(normalized_path)

    if file_assertion.exists is not None and exists != file_assertion.exists:
        failures.append(
            f"{scenario_id}: expected file {normalized_path} exists={file_assertion.exists}, got {exists}"
        )

    if not exists:
        if _has_text_assertions(file_assertion):
            failures.append(
                f"{scenario_id}: expected file {normalized_path} to exist for content assertions"
            )
        return

    if not _has_text_assertions(file_assertion):
        return

    try:
        contents = (await runtime.ctx.vfs.read_bytes(normalized_path)).decode("utf-8", errors="replace")
        _assert_text_assertions(contents, file_assertion, f"{scenario_id}: file {normalized_path}", failures)
    except Exception as caught:
        failures.append(f"{scenario_id}: failed to read {normalized_path}: {error_message(caught)}")


def _assert_memory(
    scenario_id: str,
    assertions: AssertionSpec,
    runtime: AgentCLI,
    failures: list[str],
) -> None:
    if assertions.memory is None or assertions.memory.contains is None:
        return

    memory_texts = [item.text for item in runtime.ctx.memory.recent(2**31 - 1)]
    for expected in assertions.memory.contains:
        if not any(expected in text for text in memory_texts):
            failures.append(f'{scenario_id}: expected memory to contain "{expected}"')


def _assert_trace(
    scenario_id: str,
    assertions: AssertionSpec,
    trace: OracleTrace,
    failures: list[str],
) -> None:
    trace_assertions = assertions.trace
    if trace_assertions is None:
        return

    commands = [step.command for step in trace.steps]

    if trace_assertions.max_calls is not None and len(trace.steps) > trace_assertions.max_calls:
        failures.append(
            f"{scenario_id}: expected at most {trace_assertions.max_calls} oracle calls, "
            f"got {len(trace.steps)}"
        )

    if trace_assertions.must_include is not None:
        for expected in trace_assertions.must_include:
            if not any(expected in command for command in commands):
                failures.append(
                    f'{scenario_id}: expected at least one oracle command to include "{expected}"'
                )

    if trace_assertions.forbidden is not None:
        for forbidden in trace_assertions.forbidden:
            if any(forbidden in command for command in commands):
                failures.append(
                    f'{scenario_id}: expected no oracle command to include "{forbidden}"'
                )

    if trace_assertions.steps is not None:
        for step_assertion in trace_assertions.steps:
            _assert_trace_step(scenario_id, trace, step_assertion, failures)


def _assert_trace_step(
    scenario_id: str,
    trace: OracleTrace,
    step_assertion: TraceStepAssertionSpec,
    failures: list[str],
) -> None:
    if step_assertion.index >= len(trace.steps):
        failures.append(f"{scenario_id}: expected trace step {step_assertion.index} to exist")
        return

    step = trace.steps[step_assertion.index]
    if step_assertion.exit_code is not None and step.exit_code != step_assertion.exit_code:
        failures.append(
            f"{scenario_id}: expected trace step {step_assertion.index} to exit "
            f"{step_assertion.exit_code}, got {step.exit_code}"
        )

    _assert_text_assertions(
        step.body,
        step_assertion,
        f"{scenario_id}: trace step {step_assertion.index}",
        failures,
    )


def _assert_text_assertions(
    actual: str,
    assertions: TextAssertionSpec,
    label: str,
    failures: list[str],
) -> None:
    if assertions.exact is not None and actual != assertions.exact:
        failures.append(f'{label}: expected exact match "{assertions.exact}", got "{actual}"')

    if assertions.contains is not None:
        for expected in assertions.contains:
            if expected not in actual:
                failures.append(f'{label}: expected output to include "{expected}"')

    if assertions.not_contains is not None:
        for forbidden in assertions.not_contains:
            if forbidden in actual:
                failures.append(f'{label}: expected output not to include "{forbidden}"')

    if assertions.regex is not None:
        for pattern in assertions.regex:
            if re.search(pattern, actual) is None:
                failures.append(f"{label}: expected output to match /{pattern}/")


def _has_text_assertions(assertions: TextAssertionSpec) -> bool:
    return any(
        value is not None
        for value in (
            assertions.exact,
            assertions.contains,
            assertions.not_contains,
            assertions.regex,
        )
    )
