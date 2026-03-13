import type { AgentCLI, RunExecution } from '../runtime.js';
import type { OracleCommandSpec, ScenarioSpec } from './scenario.js';

export interface OracleStepTrace {
  command: string;
  output: string;
  body: string;
  exitCode: number;
  expectedExitCode: number;
  execution: RunExecution;
}

export interface OracleTrace {
  scenarioId: string;
  steps: OracleStepTrace[];
  finalOutput: string;
  finalBody: string;
  finalExitCode: number;
  totalDurationMs: number;
}

export async function runOracle(runtime: AgentCLI, scenario: ScenarioSpec): Promise<OracleTrace> {
  if (scenario.oracle === undefined || scenario.oracle.length === 0) {
    throw new Error(`scenario ${scenario.id} does not define an oracle`);
  }

  const steps: OracleStepTrace[] = [];
  let finalOutput = '';
  let finalBody = '';
  let finalExitCode = 0;
  const started = performance.now();

  for (const oracleStep of scenario.oracle) {
    const normalizedStep = normalizeOracleStep(oracleStep);
    const execution = await runtime.runDetailed(normalizedStep.command);

    steps.push({
      command: normalizedStep.command,
      output: execution.presentation.text,
      body: execution.presentation.body,
      exitCode: execution.exitCode,
      expectedExitCode: normalizedStep.expectedExitCode,
      execution,
    });
    finalOutput = execution.presentation.text;
    finalBody = execution.presentation.body;
    finalExitCode = execution.exitCode;
  }

  return {
    scenarioId: scenario.id,
    steps,
    finalOutput,
    finalBody,
    finalExitCode,
    totalDurationMs: Math.max(0, performance.now() - started),
  };
}

function normalizeOracleStep(step: string | OracleCommandSpec): Required<OracleCommandSpec> {
  if (typeof step === 'string') {
    return {
      command: step,
      expectedExitCode: 0,
    };
  }

  return {
    command: step.command,
    expectedExitCode: step.expectedExitCode ?? 0,
  };
}
