import path from 'node:path';

import { assertScenario, buildWorld, runOracle } from '../../src/testing/index.js';
import { SCENARIO_CASES } from '../snapshot-cases.js';
import {
  SNAPSHOT_ROOT,
  serializeOracleTrace,
  serializeScenarioSpec,
  snapshotWorldState,
  withMockedNow,
  writeJson,
} from './shared.js';

export async function writeScenarioSnapshots(): Promise<number> {
  for (const scenario of SCENARIO_CASES) {
    const payload = await snapshotScenarioCase(scenario);
    await writeJson(path.join(SNAPSHOT_ROOT, 'scenarios', `${scenario.id}.json`), payload);
  }

  return SCENARIO_CASES.length;
}

async function snapshotScenarioCase(
  scenario: (typeof SCENARIO_CASES)[number],
): Promise<Record<string, unknown>> {
  return withMockedNow(async function (): Promise<Record<string, unknown>> {
    const runtime = await buildWorld(scenario.world);
    const trace = await runOracle(runtime, scenario);
    const assertionResult = await assertScenario(scenario, trace, runtime);

    return {
      id: scenario.id,
      scenario: serializeScenarioSpec(scenario),
      trace: serializeOracleTrace(trace),
      assertionResult,
      worldAfter: await snapshotWorldState(runtime.ctx.vfs, runtime.ctx.memory),
    };
  });
}
