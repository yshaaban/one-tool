import assert from 'node:assert/strict';
import test, { describe } from 'node:test';

import { assertScenario, buildWorld, runOracle } from '../../src/testing/index.js';
import { adversarialScenarios } from './scenarios/adversarial.js';
import { coreScenarios } from './scenarios/core.js';

for (const scenario of [...coreScenarios, ...adversarialScenarios]) {
  describe(`oracle: ${scenario.id}`, function (): void {
    test('oracle script completes with expected step exits', async function (): Promise<void> {
      const runtime = await buildWorld(scenario.world);
      const trace = await runOracle(runtime, scenario);

      for (const [index, step] of trace.steps.entries()) {
        assert.equal(
          step.exitCode,
          step.expectedExitCode,
          `step ${index} (${step.command}) exited ${step.exitCode} instead of ${step.expectedExitCode}:\n${step.output}`,
        );
      }
    });

    test('scenario assertions pass against oracle output and world state', async function (): Promise<void> {
      const runtime = await buildWorld(scenario.world);
      const trace = await runOracle(runtime, scenario);
      const result = await assertScenario(scenario, trace, runtime);

      assert.ok(result.passed, `Assertion failures:\n${result.failures.join('\n')}`);
    });
  });
}
