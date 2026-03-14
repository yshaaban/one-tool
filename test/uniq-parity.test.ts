import assert from 'node:assert/strict';
import test from 'node:test';

import { NodeVFS } from '../src/index.js';
import { textDecoder, textEncoder } from '../src/types.js';
import { makeCtx, runCommand } from './commands/harness.js';
import {
  hasOracleUtility,
  type OracleWorkspace,
  type OracleWorkspaceFiles,
  withOracleFixtureWorkspace,
} from './oracles/parity-harness.js';

interface UniqParityCase {
  args: string[];
  files: OracleWorkspaceFiles;
  name: string;
  stdin?: Uint8Array;
}

const PARITY_CASES: UniqParityCase[] = [
  {
    name: 'basic collapse',
    args: [],
    files: {},
    stdin: textEncoder.encode('a\na\nb\na\na\n'),
  },
  {
    name: 'count groups',
    args: ['-c'],
    files: {},
    stdin: textEncoder.encode('a\na\nb\nb\nb\n'),
  },
  {
    name: 'ignore case',
    args: ['-i'],
    files: {},
    stdin: textEncoder.encode('Error\nerror\nWARN\n'),
  },
  {
    name: 'duplicates only',
    args: ['-d'],
    files: {},
    stdin: textEncoder.encode('a\na\nb\nc\nc\n'),
  },
  {
    name: 'unique only',
    args: ['-u'],
    files: {},
    stdin: textEncoder.encode('a\na\nb\nc\nc\n'),
  },
  {
    name: 'file input',
    args: ['-c', 'input.txt'],
    files: {
      'input.txt': 'warn\nwarn\ninfo\n',
    },
  },
];

test('uniq matches host GNU uniq for the supported parity corpus', async function (t): Promise<void> {
  if (!(await hasOracleUtility('uniq'))) {
    t.skip('host uniq is not available');
    return;
  }

  for (const parityCase of PARITY_CASES) {
    await withOracleFixtureWorkspace(parityCase.files, async function (workspace): Promise<void> {
      const host = await workspace.run(
        'uniq',
        mapUniqArgs(workspace, parityCase.args, false),
        parityCase.stdin === undefined ? {} : { stdin: parityCase.stdin },
      );
      const runtime = await runRuntimeUniq(workspace, parityCase.args, parityCase.stdin);

      assert.equal(runtime.exitCode, host.exitCode, `${parityCase.name}: exit code mismatch`);
      assert.equal(runtime.stderr, host.stderr, `${parityCase.name}: stderr mismatch`);
      assert.equal(
        normalizeUniqText(textDecoder.decode(runtime.stdout)),
        normalizeUniqText(textDecoder.decode(host.stdout)),
        `${parityCase.name}: stdout mismatch`,
      );
    });
  }
});

async function runRuntimeUniq(
  workspace: OracleWorkspace,
  args: string[],
  stdin?: Uint8Array,
): Promise<{ exitCode: number; stderr: string; stdout: Uint8Array }> {
  const ctx = makeCtx({
    vfs: new NodeVFS(workspace.rootDir),
  });
  const { result } = await runCommand('uniq', mapUniqArgs(workspace, args, true), {
    ctx,
    stdin: stdin ?? new Uint8Array(),
  });
  return result;
}

function mapUniqArgs(workspace: OracleWorkspace, args: string[], runtime: boolean): string[] {
  const mapped: string[] = [];

  for (const arg of args) {
    if (arg.startsWith('-')) {
      mapped.push(arg);
      continue;
    }

    mapped.push(runtime ? `/${arg}` : workspace.path(arg));
  }

  return mapped;
}

function normalizeUniqText(text: string): string {
  return text.replace(/\n$/, '');
}
