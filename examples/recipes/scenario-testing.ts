import { assertScenario, buildWorld, runOracle, type ScenarioSpec } from 'one-tool/testing';

import {
  createExampleIO,
  printHeading,
  runIfEntrypoint,
  type ExampleRunOptions,
} from '../shared/example-utils.js';

const scenario: ScenarioSpec = {
  id: 'recipe-count-errors',
  category: 'composition',
  description: 'Count error lines in a small log.',
  prompt: 'How many ERROR lines are in the log?',
  maxTurns: 1,
  maxToolCalls: 1,
  world: {
    files: {
      '/logs/app.log': [
        '2026-03-13T10:00:00Z INFO boot',
        '2026-03-13T10:01:00Z ERROR failed login user=alice',
        '2026-03-13T10:02:00Z ERROR refund timeout order=123',
      ].join('\n'),
    },
  },
  oracle: ['grep -c ERROR /logs/app.log'],
  assertions: {
    finalAnswer: {
      exact: '2',
    },
    trace: {
      maxCalls: 1,
    },
  },
};

export async function main(options: ExampleRunOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const runtime = await buildWorld(scenario.world);
  const trace = await runOracle(runtime, scenario);
  const result = await assertScenario(scenario, trace, runtime);

  printHeading(
    io,
    'Recipe: scenario testing',
    'The same public testing helpers used in the repo can build a world, run a deterministic oracle, and assert the result.',
  );
  io.write(`Scenario: ${scenario.id}`);
  io.write(`Oracle steps: ${trace.steps.length}`);
  io.write(`Final output: ${trace.finalBody}`);
  io.write(`Assertions passed: ${result.passed}`);
}

await runIfEntrypoint(import.meta.url, main);
