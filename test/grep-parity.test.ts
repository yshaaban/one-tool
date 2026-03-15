import assert from 'node:assert/strict';
import test from 'node:test';

import { NodeVFS } from '../src/index.js';
import { textDecoder } from '../src/types.js';
import { makeCtx, runCommand } from './commands/harness.js';
import {
  hasOracleUtility,
  runGrepOracle,
  withOracleFixtureWorkspace,
} from './oracles/parity-harness.js';
import {
  GREP_PARITY_CASES,
  buildGrepHostArgs,
  buildGrepRuntimeArgs,
} from './parity-cases/grep.js';

test('grep matches host GNU grep for the supported parity corpus', async function (t): Promise<void> {
  if (!(await hasOracleUtility('grep'))) {
    t.skip('host grep is not available');
    return;
  }

  for (const parityCase of GREP_PARITY_CASES) {
    await withOracleFixtureWorkspace(parityCase.files, async function (workspace): Promise<void> {
      const host = await runGrepOracle(
        buildGrepHostArgs(parityCase, workspace.rootDir),
        parityCase.stdin === undefined
          ? { cwd: workspace.rootDir }
          : { cwd: workspace.rootDir, stdin: parityCase.stdin },
      );
      const runtime = await runRuntimeGrep(workspace.rootDir, buildGrepRuntimeArgs(parityCase), parityCase.stdin);

      assert.equal(runtime.exitCode, host.exitCode, `${parityCase.name}: exit code mismatch`);
      assert.equal(runtime.stderr, host.stderr, `${parityCase.name}: stderr mismatch`);
      assert.equal(
        normalizeGrepStdout(runtime.stdout),
        normalizeGrepStdout(host.stdout),
        `${parityCase.name}: stdout mismatch`,
      );
    });
  }
});

async function runRuntimeGrep(
  rootDir: string,
  args: string[],
  stdin: Uint8Array | undefined,
): Promise<{ exitCode: number; stderr: string; stdout: Uint8Array }> {
  const ctx = makeCtx({
    vfs: new NodeVFS(rootDir),
  });
  const { result } = await runCommand('grep', args, {
    ctx,
    stdin: stdin ?? new Uint8Array(),
  });
  return result;
}

function normalizeGrepStdout(stdout: Uint8Array): string {
  return textDecoder.decode(stdout).replace(/\n$/, '');
}
