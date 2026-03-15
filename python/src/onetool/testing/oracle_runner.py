from __future__ import annotations

import time
from dataclasses import dataclass

from ..runtime import AgentCLI, RunExecution
from .scenario import OracleCommandSpec, ScenarioSpec


@dataclass(frozen=True, slots=True)
class OracleStepTrace:
    command: str
    output: str
    body: str
    exit_code: int
    expected_exit_code: int
    execution: RunExecution


@dataclass(frozen=True, slots=True)
class OracleTrace:
    scenario_id: str
    steps: list[OracleStepTrace]
    final_output: str
    final_body: str
    final_exit_code: int
    total_duration_ms: float


async def run_oracle(runtime: AgentCLI, scenario: ScenarioSpec) -> OracleTrace:
    if not scenario.oracle:
        raise ValueError(f"scenario {scenario.id} does not define an oracle")

    steps: list[OracleStepTrace] = []
    final_output = ""
    final_body = ""
    final_exit_code = 0
    started = time.perf_counter()

    for raw_step in scenario.oracle:
        step = _normalize_oracle_step(raw_step)
        execution = await runtime.run_detailed(step.command)
        steps.append(
            OracleStepTrace(
                command=step.command,
                output=execution.presentation.text,
                body=execution.presentation.body,
                exit_code=execution.exit_code,
                expected_exit_code=step.expected_exit_code or 0,
                execution=execution,
            )
        )
        final_output = execution.presentation.text
        final_body = execution.presentation.body
        final_exit_code = execution.exit_code

    return OracleTrace(
        scenario_id=scenario.id,
        steps=steps,
        final_output=final_output,
        final_body=final_body,
        final_exit_code=final_exit_code,
        total_duration_ms=max(0.0, (time.perf_counter() - started) * 1000.0),
    )


def _normalize_oracle_step(step: str | OracleCommandSpec) -> OracleCommandSpec:
    if isinstance(step, str):
        return OracleCommandSpec(command=step, expected_exit_code=0)
    return OracleCommandSpec(
        command=step.command,
        expected_exit_code=0 if step.expected_exit_code is None else step.expected_exit_code,
    )
