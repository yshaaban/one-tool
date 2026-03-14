import assert from 'node:assert/strict';
import test from 'node:test';

import { NodeVFS } from '../src/index.js';
import { textDecoder } from '../src/types.js';
import { makeCtx, runCommand } from './commands/harness.js';
import {
  hasOracleUtility,
  runLsOracle,
  type OracleWorkspaceFiles,
  withOracleFixtureWorkspace,
} from './oracles/parity-harness.js';

interface LsParityCase {
  args: string[];
  files: OracleWorkspaceFiles;
  name: string;
}

const PARITY_CASES: LsParityCase[] = [
  {
    name: 'plain directory listing hides dotfiles',
    files: {
      'tree/.hidden': 'secret\n',
      'tree/nested/child.txt': 'child\n',
      'tree/visible.txt': 'visible\n',
    },
    args: ['tree'],
  },
  {
    name: 'all listing includes dot entries',
    files: {
      'tree/.hidden': 'secret\n',
      'tree/visible.txt': 'visible\n',
    },
    args: ['-a', 'tree'],
  },
  {
    name: 'recursive listing matches host shape',
    files: {
      'tree/nested/child.txt': 'child\n',
      'tree/visible.txt': 'visible\n',
    },
    args: ['-R', 'tree'],
  },
  {
    name: 'single file target',
    files: {
      'item.txt': 'hello\n',
    },
    args: ['item.txt'],
  },
];

test('ls matches host GNU ls for the supported parity corpus', async function (t): Promise<void> {
  if (!(await hasOracleUtility('ls'))) {
    t.skip('host ls is not available');
    return;
  }

  for (const parityCase of PARITY_CASES) {
    await withOracleFixtureWorkspace(parityCase.files, async function (workspace): Promise<void> {
      const host = await runLsOracle(toHostArgs(parityCase.args, workspace.rootDir), {
        cwd: workspace.rootDir,
      });
      const runtime = await runRuntimeLs(workspace.rootDir, toRuntimeArgs(parityCase.args));

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

function toHostArgs(args: string[], rootDir: string): string[] {
  if (args.length === 0) {
    return args;
  }

  const mapped = [...args];
  const last = mapped[mapped.length - 1]!;
  if (!last.startsWith('-')) {
    mapped[mapped.length - 1] = `${rootDir}/${last}`;
  }
  return mapped;
}

function toRuntimeArgs(args: string[]): string[] {
  if (args.length === 0) {
    return args;
  }

  const mapped = [...args];
  const last = mapped[mapped.length - 1]!;
  if (!last.startsWith('-')) {
    mapped[mapped.length - 1] = `/${last}`;
  }
  return mapped;
}

function stripOracleRoot(output: string, rootDir: string): string {
  return output.split(rootDir).join('');
}

function normalizeLsOutput(output: string): string {
  return output.trimEnd();
}
