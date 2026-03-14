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

interface WcParityCase {
  args: string[];
  files: OracleWorkspaceFiles;
  name: string;
  stdin?: Uint8Array;
}

const PARITY_CASES: WcParityCase[] = [
  {
    name: 'default file counts',
    files: {
      'counts.txt': 'alpha beta\ngamma',
    },
    args: ['counts.txt'],
  },
  {
    name: 'line count for file',
    files: {
      'counts.txt': 'alpha beta\ngamma',
    },
    args: ['-l', 'counts.txt'],
  },
  {
    name: 'word and byte counts from stdin',
    files: {},
    args: ['-w', '-c'],
    stdin: textEncoder.encode('one two'),
  },
  {
    name: 'clustered line and word counts',
    files: {
      'counts.txt': 'alpha beta\ngamma',
    },
    args: ['-lw', 'counts.txt'],
  },
];

test('wc matches host GNU wc for the supported parity corpus', async function (t): Promise<void> {
  if (!(await hasOracleUtility('wc'))) {
    t.skip('host wc is not available');
    return;
  }

  for (const parityCase of PARITY_CASES) {
    await withOracleFixtureWorkspace(parityCase.files, async function (workspace): Promise<void> {
      const host = await workspace.run(
        'wc',
        mapWcArgs(workspace, parityCase.args, false),
        parityCase.stdin === undefined ? {} : { stdin: parityCase.stdin },
      );
      const runtime = await runRuntimeWc(workspace, parityCase.args, parityCase.stdin);

      assert.equal(runtime.exitCode, host.exitCode, `${parityCase.name}: exit code mismatch`);
      assert.equal(runtime.stderr, host.stderr, `${parityCase.name}: stderr mismatch`);
      assert.equal(
        normalizeWcText(textDecoder.decode(runtime.stdout), workspace.rootDir),
        normalizeWcText(textDecoder.decode(host.stdout), workspace.rootDir),
        `${parityCase.name}: stdout mismatch`,
      );
    });
  }
});

async function runRuntimeWc(
  workspace: OracleWorkspace,
  args: string[],
  stdin?: Uint8Array,
): Promise<{ exitCode: number; stderr: string; stdout: Uint8Array }> {
  const ctx = makeCtx({
    vfs: new NodeVFS(workspace.rootDir),
  });
  const { result } = await runCommand('wc', mapWcArgs(workspace, args, true), {
    ctx,
    stdin: stdin ?? new Uint8Array(),
  });
  return result;
}

function mapWcArgs(workspace: OracleWorkspace, args: string[], runtime: boolean): string[] {
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

function normalizeWcText(text: string, rootDir: string): string {
  const escapedRoot = escapeRegExp(rootDir);
  return text.replace(new RegExp(escapedRoot, 'g'), '').replace(/\s+/g, ' ').trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
