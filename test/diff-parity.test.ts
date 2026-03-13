import assert from 'node:assert/strict';
import test from 'node:test';

import { NodeVFS } from '../src/index.js';
import { textDecoder, textEncoder } from '../src/types.js';
import { makeCtx, runCommand } from './commands/harness.js';
import {
  hasOracleUtility,
  oracleDirectory,
  type OracleWorkspace,
  type OracleWorkspaceFiles,
  withOracleFixtureWorkspace,
} from './oracles/parity-harness.js';

interface DiffParityCase {
  name: string;
  files: OracleWorkspaceFiles;
  args: string[];
  stdin?: Uint8Array;
}

const DIFF_PARITY_CASES: DiffParityCase[] = [
  {
    name: 'normal file diff',
    files: {
      'left.txt': 'alpha\n',
      'right.txt': 'beta\n',
    },
    args: ['left.txt', 'right.txt'],
  },
  {
    name: 'unified diff',
    files: {
      'left.txt': 'alpha\nbravo\n',
      'right.txt': 'alpha\ncharlie\n',
    },
    args: ['-u', 'left.txt', 'right.txt'],
  },
  {
    name: 'context diff',
    files: {
      'left.txt': 'alpha\nbravo\n',
      'right.txt': 'alpha\ncharlie\n',
    },
    args: ['-c', 'left.txt', 'right.txt'],
  },
  {
    name: 'binary summary',
    files: {
      'left.bin': new Uint8Array([0, 1, 2]),
      'right.bin': new Uint8Array([0, 1, 3]),
    },
    args: ['left.bin', 'right.bin'],
  },
  {
    name: 'recursive directory diff',
    files: {
      'd1/a.txt': 'alpha\n',
      'd2/a.txt': 'beta\n',
      'd1/only.txt': 'left only\n',
      'd1/sub': oracleDirectory(),
      'd2/sub': oracleDirectory(),
      'd1/sub/shared.txt': 'same\n',
      'd2/sub/shared.txt': 'same\n',
    },
    args: ['-r', 'd1', 'd2'],
  },
  {
    name: 'ignore case and space change',
    files: {
      'left.txt': 'Alpha   Bravo\n',
      'right.txt': 'alpha bravo\n',
    },
    args: ['-b', '-i', 'left.txt', 'right.txt'],
  },
  {
    name: 'stdin operand',
    files: {
      'right.txt': 'beta\n',
    },
    args: ['-', 'right.txt'],
    stdin: textEncoder.encode('alpha\n'),
  },
];

test('diff matches host GNU diff for the parity corpus', async function (t): Promise<void> {
  if (!(await hasOracleUtility('diff'))) {
    t.skip('host diff is not available');
    return;
  }

  for (const parityCase of DIFF_PARITY_CASES) {
    await withOracleFixtureWorkspace(parityCase.files, async function (workspace): Promise<void> {
      const host = await workspace.run(
        'diff',
        toOracleArgs(workspace, parityCase.args),
        parityCase.stdin === undefined ? {} : { stdin: parityCase.stdin },
      );
      const runtime = await runRuntimeDiff(workspace, parityCase.args, parityCase.stdin);

      assert.equal(runtime.exitCode, host.exitCode, `${parityCase.name}: exit code mismatch`);
      assert.equal(runtime.stderr, host.stderr, `${parityCase.name}: stderr mismatch`);
      assert.equal(
        normalizeDiffText(textDecoder.decode(runtime.stdout), workspace.rootDir),
        normalizeDiffText(textDecoder.decode(host.stdout), workspace.rootDir),
        `${parityCase.name}: stdout mismatch`,
      );
    });
  }
});

async function runRuntimeDiff(
  workspace: OracleWorkspace,
  args: string[],
  stdin?: Uint8Array,
): Promise<{ stdout: Uint8Array; stderr: string; exitCode: number }> {
  const ctx = makeCtx({
    vfs: new NodeVFS(workspace.rootDir),
  });
  const mappedArgs = args.map(toRuntimePath);
  const { result } = await runCommand('diff', mappedArgs, {
    ctx,
    stdin: stdin ?? new Uint8Array(),
  });
  return result;
}

function toOracleArgs(workspace: OracleWorkspace, args: string[]): string[] {
  return args.map(function (arg) {
    if (isDiffOptionToken(arg)) {
      return arg;
    }
    return workspace.path(arg);
  });
}

function toRuntimePath(path: string): string {
  if (isDiffOptionToken(path)) {
    return path;
  }
  return path.startsWith('/') ? path : `/${path}`;
}

function isDiffOptionToken(value: string): boolean {
  return value === '-' || value.startsWith('-');
}

function normalizeDiffText(text: string, rootDir: string): string {
  const escapedRoot = escapeRegExp(rootDir);
  const withoutHostRoot = text.replace(new RegExp(escapedRoot, 'g'), '');
  return withoutHostRoot.replace(/^(\*\*\*|---|\+\+\+)\s+([^\t]+)\t.*$/gm, '$1 $2\t<TIMESTAMP>');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
