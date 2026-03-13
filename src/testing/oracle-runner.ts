import type { AgentCLI } from '../runtime.js';
import type { OracleCommandSpec, ScenarioSpec } from './scenario.js';

export interface OracleStepTrace {
  command: string;
  output: string;
  body: string;
  exitCode: number;
  expectedExitCode: number;
}

export interface OracleTrace {
  scenarioId: string;
  steps: OracleStepTrace[];
  finalOutput: string;
  finalBody: string;
  finalExitCode: number;
  totalDurationMs: number;
}

interface PresentedOutput {
  body: string;
  exitCode: number;
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
    const output = await runtime.run(normalizedStep.command);
    const presented = parsePresentedOutput(output);

    steps.push({
      command: normalizedStep.command,
      output,
      body: presented.body,
      exitCode: presented.exitCode,
      expectedExitCode: normalizedStep.expectedExitCode,
    });
    finalOutput = output;
    finalBody = presented.body;
    finalExitCode = presented.exitCode;
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

function parsePresentedOutput(output: string): PresentedOutput {
  const footerMatch = output.match(/\[exit:(\d+) \| [^\]]+\]\s*$/);
  if (!footerMatch || footerMatch.index === undefined) {
    throw new Error(`oracle output is missing an exit footer:\n${output}`);
  }

  const body = output.slice(0, footerMatch.index).replace(/\n+$/, '');
  return {
    body,
    exitCode: Number(footerMatch[1]),
  };
}
