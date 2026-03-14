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

interface HeadParityCase {
  args: string[];
  binary?: boolean;
  files: OracleWorkspaceFiles;
  name: string;
  stdin?: Uint8Array;
}

const PARITY_CASES: HeadParityCase[] = [
  {
    name: 'line mode from file',
    files: {
      'notes.txt': 'a\nb\nc\nd\n',
    },
    args: ['-n', '2', 'notes.txt'],
  },
  {
    name: 'legacy numeric shorthand',
    files: {
      'notes.txt': 'a\nb\nc\nd\n',
    },
    args: ['-2', 'notes.txt'],
  },
  {
    name: 'byte mode from file',
    files: {
      'bytes.bin': new Uint8Array([0, 1, 2, 3, 4]),
    },
    args: ['-c', '3', 'bytes.bin'],
    binary: true,
  },
  {
    name: 'attached byte count from file',
    files: {
      'bytes.bin': new Uint8Array([0, 1, 2, 3, 4]),
    },
    args: ['-c3', 'bytes.bin'],
    binary: true,
  },
  {
    name: 'line mode from stdin',
    files: {},
    args: ['-n', '2'],
    stdin: textEncoder.encode('a\nb\nc\nd\n'),
  },
];

test('head matches host GNU head for the supported parity corpus', async function (t): Promise<void> {
  if (!(await hasOracleUtility('head'))) {
    t.skip('host head is not available');
    return;
  }

  for (const parityCase of PARITY_CASES) {
    await withOracleFixtureWorkspace(parityCase.files, async function (workspace): Promise<void> {
      const host = await workspace.run(
        'head',
        mapTextSliceArgs(workspace, parityCase.args, false),
        parityCase.stdin === undefined ? {} : { stdin: parityCase.stdin },
      );
      const runtime = await runRuntimeHead(workspace, parityCase.args, parityCase.stdin);

      assert.equal(runtime.exitCode, host.exitCode, `${parityCase.name}: exit code mismatch`);
      assert.equal(runtime.stderr, host.stderr, `${parityCase.name}: stderr mismatch`);

      if (parityCase.binary) {
        assert.deepEqual(
          Array.from(runtime.stdout),
          Array.from(host.stdout),
          `${parityCase.name}: stdout mismatch`,
        );
        return;
      }

      assert.equal(
        normalizeTextSliceOutput(textDecoder.decode(runtime.stdout)),
        normalizeTextSliceOutput(textDecoder.decode(host.stdout)),
        `${parityCase.name}: stdout mismatch`,
      );
    });
  }
});

async function runRuntimeHead(
  workspace: OracleWorkspace,
  args: string[],
  stdin?: Uint8Array,
): Promise<{ exitCode: number; stderr: string; stdout: Uint8Array }> {
  const ctx = makeCtx({
    vfs: new NodeVFS(workspace.rootDir),
  });
  const { result } = await runCommand('head', mapTextSliceArgs(workspace, args, true), {
    ctx,
    stdin: stdin ?? new Uint8Array(),
  });
  return result;
}

function mapTextSliceArgs(workspace: OracleWorkspace, args: string[], runtime: boolean): string[] {
  const mapped: string[] = [];
  let expectsValue = false;

  for (const arg of args) {
    if (expectsValue) {
      mapped.push(arg);
      expectsValue = false;
      continue;
    }

    if (arg === '-n' || arg === '-c') {
      mapped.push(arg);
      expectsValue = true;
      continue;
    }

    if (arg.startsWith('-')) {
      mapped.push(arg);
      continue;
    }

    mapped.push(runtime ? `/${arg}` : workspace.path(arg));
  }

  return mapped;
}

function normalizeTextSliceOutput(text: string): string {
  return text.replace(/\n$/, '');
}
