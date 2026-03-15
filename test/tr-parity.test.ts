import assert from 'node:assert/strict';
import test from 'node:test';

import { runCommand } from './commands/harness.js';
import { hasOracleUtility, runTrOracle } from './oracles/parity-harness.js';
import { TR_PARITY_CASES } from './parity-cases/tr.js';

test('tr matches host GNU tr for the parity corpus', async function (t): Promise<void> {
  if (!(await hasOracleUtility('tr'))) {
    t.skip('host tr is not available');
    return;
  }

  for (const parityCase of TR_PARITY_CASES) {
    const host = await runTrOracle(parityCase.args, { stdin: parityCase.stdin });
    const { result } = await runCommand('tr', parityCase.args, { stdin: parityCase.stdin });

    assert.equal(result.exitCode, host.exitCode, `${parityCase.name}: exit code mismatch`);
    assert.deepEqual(
      Array.from(result.stdout),
      Array.from(host.stdout),
      `${parityCase.name}: stdout mismatch`,
    );
    assert.equal(result.stderr, '', `${parityCase.name}: expected no stderr`);
  }
});
