import assert from 'node:assert/strict';
import test from 'node:test';

import { NodeVFS } from '../src/index.js';
import { textDecoder } from '../src/types.js';
import { makeCtx, runCommand } from './commands/harness.js';
import {
  hasOracleUtility,
  runLsOracle,
  withOracleFixtureWorkspace,
} from './oracles/parity-harness.js';
import { LS_PARITY_CASES, buildLsHostArgs, buildLsRuntimeArgs } from './parity-cases/ls.js';

test('ls matches host GNU ls for the supported parity corpus', async function (t): Promise<void> {
  if (!(await hasOracleUtility('ls'))) {
    t.skip('host ls is not available');
    return;
  }

  for (const parityCase of LS_PARITY_CASES) {
    await withOracleFixtureWorkspace(parityCase.files, async function (workspace): Promise<void> {
      const host = await runLsOracle(buildLsHostArgs(parityCase.args, workspace.rootDir), {
        cwd: workspace.rootDir,
      });
      const runtime = await runRuntimeLs(workspace.rootDir, buildLsRuntimeArgs(parityCase.args));

      assert.equal(runtime.exitCode, host.exitCode, `${parityCase.name}: exit code mismatch`);
      assert.equal(runtime.stderr, host.stderr, `${parityCase.name}: stderr mismatch`);
      assert.equal(
        normalizeLsOutput(runtime.stdoutText),
        normalizeLsOutput(stripOracleRoot(textDecoder.decode(host.stdout), workspace.rootDir)),
        `${parityCase.name}: stdout mismatch`,
      );
    });
  }
});

async function runRuntimeLs(
  rootDir: string,
  args: string[],
): Promise<{ exitCode: number; stderr: string; stdoutText: string }> {
  const ctx = makeCtx({
    vfs: new NodeVFS(rootDir),
  });
  const { result } = await runCommand('ls', args, { ctx });
  return {
    exitCode: result.exitCode,
    stderr: result.stderr,
    stdoutText: new TextDecoder().decode(result.stdout),
  };
}

function stripOracleRoot(output: string, rootDir: string): string {
  return output.split(rootDir).join('');
}

function normalizeLsOutput(output: string): string {
  return output.trimEnd();
}
