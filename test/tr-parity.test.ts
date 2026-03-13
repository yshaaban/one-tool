import assert from 'node:assert/strict';
import test from 'node:test';

import { runCommand } from './commands/harness.js';
import { hasOracleUtility, runTrOracle } from './oracles/parity-harness.js';

const PARITY_CASES: Array<{ name: string; args: string[]; stdin: Uint8Array }> = [
  {
    name: 'translate lowercase to uppercase',
    args: ['a-z', 'A-Z'],
    stdin: Uint8Array.from([98, 97, 110, 97, 110, 97, 10]),
  },
  {
    name: 'delete digits',
    args: ['-d', '0-9'],
    stdin: Uint8Array.from([97, 49, 98, 50, 99, 51, 10]),
  },
  {
    name: 'squeeze spaces',
    args: ['-s', ' '],
    stdin: Uint8Array.from([97, 32, 32, 32, 98, 10]),
  },
  {
    name: 'delete then squeeze newlines',
    args: ['-ds', '0-9', '\\n'],
    stdin: Uint8Array.from([97, 49, 10, 10, 50, 98, 10]),
  },
  {
    name: 'complement translation',
    args: ['-c', 'a', 'z'],
    stdin: Uint8Array.from([97, 98, 10]),
  },
  {
    name: 'truncate set1 to string2 length',
    args: ['-t', 'abcd', 'xy'],
    stdin: Uint8Array.from([97, 98, 99, 100, 10]),
  },
  {
    name: 'paired case classes',
    args: ['[:lower:]', '[:upper:]'],
    stdin: Uint8Array.from([97, 98, 99, 49, 50, 51, 10]),
  },
];

test('tr matches host GNU tr for the parity corpus', async function (t): Promise<void> {
  if (!(await hasOracleUtility('tr'))) {
    t.skip('host tr is not available');
    return;
  }

  for (const parityCase of PARITY_CASES) {
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
