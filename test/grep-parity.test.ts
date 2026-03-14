import assert from 'node:assert/strict';
import test from 'node:test';

import { NodeVFS } from '../src/index.js';
import { textDecoder, textEncoder } from '../src/types.js';
import { makeCtx, runCommand } from './commands/harness.js';
import {
  hasOracleUtility,
  runGrepOracle,
  withOracleFixtureWorkspace,
  type OracleWorkspaceFiles,
} from './oracles/parity-harness.js';

interface GrepParityCase {
  files: OracleWorkspaceFiles;
  filePath?: string;
  flags?: string[];
  name: string;
  pattern: string;
  stdin?: Uint8Array;
}

const PARITY_CASES: GrepParityCase[] = [
  {
    name: 'ignore case with line numbers',
    files: {
      'app.log': 'INFO startup\nerror timeout\nWARN retry\nerror db\n',
    },
    flags: ['-i', '-n'],
    pattern: 'error',
    filePath: 'app.log',
  },
  {
    name: 'fixed string only matching',
    files: {
      'app.log': 'error timeout\nWARN timeout\ntimeout timeout\n',
    },
    flags: ['-F', '-o'],
    pattern: 'timeout',
    filePath: 'app.log',
  },
  {
    name: 'whole line regex',
    files: {
      'app.log': 'WARN retry\nWARN retry later\n',
    },
    flags: ['-x'],
    pattern: 'WARN retry',
    filePath: 'app.log',
  },
  {
    name: 'count lines from stdin',
    files: {},
    flags: ['-c'],
    pattern: 'refund',
    stdin: textEncoder.encode('refund created\nrefund updated\nskip\n'),
  },
  {
    name: 'quiet fixed string from stdin',
    files: {},
    flags: ['-q', '-F'],
    pattern: 'refund',
    stdin: textEncoder.encode('refund created\nskip\n'),
  },
  {
    name: 'no matches from stdin',
    files: {},
    flags: ['-F'],
    pattern: 'missing',
    stdin: textEncoder.encode('refund created\nskip\n'),
  },
];

test('grep matches host GNU grep for the supported parity corpus', async function (t): Promise<void> {
  if (!(await hasOracleUtility('grep'))) {
    t.skip('host grep is not available');
    return;
  }

  for (const parityCase of PARITY_CASES) {
    await withOracleFixtureWorkspace(parityCase.files, async function (workspace): Promise<void> {
      const host = await runGrepOracle(
        buildHostArgs(parityCase, workspace.rootDir),
        parityCase.stdin === undefined
          ? { cwd: workspace.rootDir }
          : { cwd: workspace.rootDir, stdin: parityCase.stdin },
      );
      const runtime = await runRuntimeGrep(workspace.rootDir, buildRuntimeArgs(parityCase), parityCase.stdin);

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

function buildHostArgs(parityCase: GrepParityCase, rootDir: string): string[] {
  const args = [...(parityCase.flags ?? []), parityCase.pattern];
  if (parityCase.filePath !== undefined) {
    args.push(`${rootDir}/${parityCase.filePath}`);
  }
  return args;
}

function buildRuntimeArgs(parityCase: GrepParityCase): string[] {
  const args = [...(parityCase.flags ?? []), parityCase.pattern];
  if (parityCase.filePath !== undefined) {
    args.push(`/${parityCase.filePath}`);
  }
  return args;
}

function normalizeGrepStdout(stdout: Uint8Array): string {
  return textDecoder.decode(stdout).replace(/\n$/, '');
}
