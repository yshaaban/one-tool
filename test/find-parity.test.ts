import assert from 'node:assert/strict';
import test from 'node:test';

import { NodeVFS } from '../src/index.js';
import { textDecoder } from '../src/types.js';
import { makeCtx, runCommand } from './commands/harness.js';
import {
  hasOracleUtility,
  runFindOracle,
  type OracleWorkspaceFiles,
  withOracleFixtureWorkspace,
} from './oracles/parity-harness.js';

interface FindParityCase {
  args: string[];
  files: OracleWorkspaceFiles;
  name: string;
}

const PARITY_CASES: FindParityCase[] = [
  {
    name: 'plain recursive walk',
    files: {
      'tree/alpha.txt': 'a\n',
      'tree/nested/bravo.md': 'b\n',
    },
    args: ['tree'],
  },
  {
    name: 'type filter alias',
    files: {
      'tree/alpha.txt': 'a\n',
      'tree/nested/bravo.md': 'b\n',
    },
    args: ['tree', '-type', 'f'],
  },
  {
    name: 'name filter alias',
    files: {
      'tree/alpha.txt': 'a\n',
      'tree/nested/bravo.md': 'b\n',
    },
    args: ['tree', '-name', '*.md'],
  },
  {
    name: 'max depth alias',
    files: {
      'tree/alpha.txt': 'a\n',
      'tree/nested/bravo.md': 'b\n',
    },
    args: ['tree', '-maxdepth', '1'],
  },
];

test('find matches host GNU find for the supported parity corpus', async function (t): Promise<void> {
  if (!(await hasOracleUtility('find'))) {
    t.skip('host find is not available');
    return;
  }

  for (const parityCase of PARITY_CASES) {
    await withOracleFixtureWorkspace(parityCase.files, async function (workspace): Promise<void> {
      const host = await runFindOracle(toHostArgs(parityCase.args, workspace.rootDir), {
        cwd: workspace.rootDir,
      });
      const runtime = await runRuntimeFind(workspace.rootDir, toRuntimeArgs(parityCase.args));

      assert.equal(runtime.exitCode, host.exitCode, `${parityCase.name}: exit code mismatch`);
      assert.equal(runtime.stderr, host.stderr, `${parityCase.name}: stderr mismatch`);
      assert.equal(
        normalizeFindOutput(runtime.stdoutText),
        normalizeFindOutput(stripOracleRoot(textDecoder.decode(host.stdout), workspace.rootDir)),
        `${parityCase.name}: stdout mismatch`,
      );
    });
  }
});

async function runRuntimeFind(
  rootDir: string,
  args: string[],
): Promise<{ exitCode: number; stderr: string; stdoutText: string }> {
  const ctx = makeCtx({
    vfs: new NodeVFS(rootDir),
  });
  const { result } = await runCommand('find', args, { ctx });
  return {
    exitCode: result.exitCode,
    stderr: result.stderr,
    stdoutText: new TextDecoder().decode(result.stdout),
  };
}

function toHostArgs(args: string[], rootDir: string): string[] {
  if (args.length === 0) {
    return args;
  }

  const mapped = [...args];
  mapped[0] = `${rootDir}/${mapped[0]!}`;
  return mapped;
}

function toRuntimeArgs(args: string[]): string[] {
  if (args.length === 0) {
    return args;
  }

  const mapped = [...args];
  mapped[0] = `/${mapped[0]!}`;
  return mapped;
}

function stripOracleRoot(output: string, rootDir: string): string {
  return output.split(rootDir).join('');
}

function normalizeFindOutput(output: string): string {
  return output.trimEnd();
}
