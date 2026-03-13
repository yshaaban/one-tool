import { textDecoder } from '../types.js';
import { errorMessage } from '../utils.js';
import type { AgentCLI } from '../runtime.js';
import type {
  AssertionSpec,
  FileAssertionSpec,
  ScenarioSpec,
  TextAssertionSpec,
  TraceStepAssertionSpec,
} from './scenario.js';
import type { OracleTrace } from './oracle-runner.js';

export interface AssertionResult {
  passed: boolean;
  failures: string[];
}

export async function assertScenario(
  scenario: ScenarioSpec,
  trace: OracleTrace,
  runtime: AgentCLI,
): Promise<AssertionResult> {
  const failures: string[] = [];

  if (trace.steps.length > scenario.maxToolCalls) {
    failures.push(
      `${scenario.id}: oracle used ${trace.steps.length} tool calls, exceeding maxToolCalls=${scenario.maxToolCalls}`,
    );
  }

  assertExpectedExitCodes(scenario, trace, failures);
  assertFinalAnswer(scenario.id, scenario.assertions, trace, failures);
  await assertFiles(scenario.id, scenario.assertions, runtime, failures);
  assertMemory(scenario.id, scenario.assertions, runtime, failures);
  assertTrace(scenario.id, scenario.assertions, trace, failures);

  return {
    passed: failures.length === 0,
    failures,
  };
}

function assertExpectedExitCodes(scenario: ScenarioSpec, trace: OracleTrace, failures: string[]): void {
  for (let index = 0; index < trace.steps.length; index += 1) {
    const step = trace.steps[index]!;
    if (step.exitCode !== step.expectedExitCode) {
      failures.push(
        `${scenario.id}: oracle step ${index} exited ${step.exitCode}, expected ${step.expectedExitCode}: ${step.command}`,
      );
    }
  }
}

function assertFinalAnswer(
  scenarioId: string,
  assertions: AssertionSpec,
  trace: OracleTrace,
  failures: string[],
): void {
  if (assertions.finalAnswer === undefined) {
    return;
  }

  assertTextAssertions(trace.finalBody, assertions.finalAnswer, `${scenarioId}: final output`, failures);
}

async function assertFiles(
  scenarioId: string,
  assertions: AssertionSpec,
  runtime: AgentCLI,
  failures: string[],
): Promise<void> {
  if (assertions.files === undefined) {
    return;
  }

  for (const fileAssertion of assertions.files) {
    await assertFile(scenarioId, fileAssertion, runtime, failures);
  }
}

async function assertFile(
  scenarioId: string,
  fileAssertion: FileAssertionSpec,
  runtime: AgentCLI,
  failures: string[],
): Promise<void> {
  const normalizedPath = runtime.ctx.vfs.normalize(fileAssertion.path);
  const exists = await runtime.ctx.vfs.exists(normalizedPath);

  if (fileAssertion.exists !== undefined && exists !== fileAssertion.exists) {
    failures.push(
      `${scenarioId}: expected file ${normalizedPath} exists=${fileAssertion.exists}, got ${exists}`,
    );
  }

  if (!exists) {
    if (hasTextAssertions(fileAssertion)) {
      failures.push(`${scenarioId}: expected file ${normalizedPath} to exist for content assertions`);
    }
    return;
  }

  if (!hasTextAssertions(fileAssertion)) {
    return;
  }

  try {
    const contents = textDecoder.decode(await runtime.ctx.vfs.readBytes(normalizedPath));
    assertTextAssertions(contents, fileAssertion, `${scenarioId}: file ${normalizedPath}`, failures);
  } catch (caught) {
    failures.push(`${scenarioId}: failed to read ${normalizedPath}: ${errorMessage(caught)}`);
  }
}

function assertMemory(
  scenarioId: string,
  assertions: AssertionSpec,
  runtime: AgentCLI,
  failures: string[],
): void {
  if (assertions.memory?.contains === undefined) {
    return;
  }

  const memoryTexts = runtime.ctx.memory.recent(Number.MAX_SAFE_INTEGER).map(function (item) {
    return item.text;
  });

  for (const expected of assertions.memory.contains) {
    const found = memoryTexts.some(function (text) {
      return text.includes(expected);
    });
    if (!found) {
      failures.push(`${scenarioId}: expected memory to contain "${expected}"`);
    }
  }
}

function assertTrace(
  scenarioId: string,
  assertions: AssertionSpec,
  trace: OracleTrace,
  failures: string[],
): void {
  const traceAssertions = assertions.trace;
  if (traceAssertions === undefined) {
    return;
  }

  const commands = trace.steps.map(function (step) {
    return step.command;
  });

  if (traceAssertions.maxCalls !== undefined && trace.steps.length > traceAssertions.maxCalls) {
    failures.push(
      `${scenarioId}: expected at most ${traceAssertions.maxCalls} oracle calls, got ${trace.steps.length}`,
    );
  }

  if (traceAssertions.mustInclude !== undefined) {
    for (const expected of traceAssertions.mustInclude) {
      const found = commands.some(function (command) {
        return command.includes(expected);
      });
      if (!found) {
        failures.push(`${scenarioId}: expected at least one oracle command to include "${expected}"`);
      }
    }
  }

  if (traceAssertions.forbidden !== undefined) {
    for (const forbidden of traceAssertions.forbidden) {
      const found = commands.some(function (command) {
        return command.includes(forbidden);
      });
      if (found) {
        failures.push(`${scenarioId}: expected no oracle command to include "${forbidden}"`);
      }
    }
  }

  if (traceAssertions.steps !== undefined) {
    for (const stepAssertion of traceAssertions.steps) {
      assertTraceStep(scenarioId, trace, stepAssertion, failures);
    }
  }
}

function assertTraceStep(
  scenarioId: string,
  trace: OracleTrace,
  stepAssertion: TraceStepAssertionSpec,
  failures: string[],
): void {
  const step = trace.steps[stepAssertion.index];
  if (step === undefined) {
    failures.push(`${scenarioId}: expected trace step ${stepAssertion.index} to exist`);
    return;
  }

  if (stepAssertion.exitCode !== undefined && step.exitCode !== stepAssertion.exitCode) {
    failures.push(
      `${scenarioId}: expected trace step ${stepAssertion.index} to exit ${stepAssertion.exitCode}, got ${step.exitCode}`,
    );
  }

  assertTextAssertions(
    step.body,
    stepAssertion,
    `${scenarioId}: trace step ${stepAssertion.index}`,
    failures,
  );
}

function assertTextAssertions(
  actual: string,
  assertions: TextAssertionSpec,
  label: string,
  failures: string[],
): void {
  if (assertions.exact !== undefined && actual !== assertions.exact) {
    failures.push(`${label}: expected exact match "${assertions.exact}", got "${actual}"`);
  }

  if (assertions.contains !== undefined) {
    for (const expected of assertions.contains) {
      if (!actual.includes(expected)) {
        failures.push(`${label}: expected output to include "${expected}"`);
      }
    }
  }

  if (assertions.notContains !== undefined) {
    for (const forbidden of assertions.notContains) {
      if (actual.includes(forbidden)) {
        failures.push(`${label}: expected output not to include "${forbidden}"`);
      }
    }
  }

  if (assertions.regex !== undefined) {
    for (const pattern of assertions.regex) {
      if (!new RegExp(pattern).test(actual)) {
        failures.push(`${label}: expected output to match /${pattern}/`);
      }
    }
  }
}

function hasTextAssertions(assertions: TextAssertionSpec): boolean {
  return (
    assertions.exact !== undefined ||
    assertions.contains !== undefined ||
    assertions.notContains !== undefined ||
    assertions.regex !== undefined
  );
}
