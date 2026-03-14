import assert from 'node:assert/strict';
import test from 'node:test';

import { runCommand } from './commands/harness.js';
import { hasOracleUtility, runEchoOracle } from './oracles/parity-harness.js';

const PARITY_CASES: Array<{ args: string[]; name: string }> = [
  {
    name: 'basic words',
    args: ['hello', 'world'],
  },
  {
    name: 'suppress trailing newline',
    args: ['-n', 'hello'],
  },
  {
    name: 'interpret escapes',
    args: ['-e', 'line\\none\\tindent'],
  },
  {
    name: 'explicitly disable escape interpretation',
    args: ['-e', '-E', 'line\\none'],
  },
  {
    name: 'stop output with backslash-c',
    args: ['-e', 'hello\\cignored'],
  },
];

test('echo matches host GNU echo for the supported parity corpus', async function (t): Promise<void> {
  if (!(await hasOracleUtility('echo'))) {
    t.skip('host echo is not available');
    return;
  }

  for (const parityCase of PARITY_CASES) {
    const host = await runEchoOracle(parityCase.args);
    const { result } = await runCommand('echo', parityCase.args);

    assert.equal(result.exitCode, host.exitCode, `${parityCase.name}: exit code mismatch`);
    assert.deepEqual(
      Array.from(result.stdout),
      Array.from(host.stdout),
      `${parityCase.name}: stdout mismatch`,
    );
    assert.equal(result.stderr, host.stderr, `${parityCase.name}: stderr mismatch`);
  }
});
