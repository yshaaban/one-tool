import assert from 'node:assert/strict';
import test from 'node:test';

import { NodeVFS } from '../src/index.js';
import { textDecoder, textEncoder } from '../src/types.js';
import { makeCtx, runCommand } from './commands/harness.js';
import {
  hasOracleUtility,
  type OracleWorkspace,
  type OracleWorkspaceFiles,
  runOracleProcess,
  withOracleFixtureWorkspace,
} from './oracles/parity-harness.js';

interface SortParityCase {
  args: string[];
  files?: OracleWorkspaceFiles;
  name: string;
  stdin?: Uint8Array;
}

const PARITY_CASES: SortParityCase[] = [
  {
    name: 'default lexical sort',
    args: [],
    stdin: textEncoder.encode('pear\napple\nbanana\napple\n'),
  },
  {
    name: 'numeric sort',
    args: ['-n'],
    stdin: textEncoder.encode('10\n2\n30\napple\n'),
  },
  {
    name: 'case-insensitive sort',
    args: ['-f'],
    stdin: textEncoder.encode('beta\nAlpha\napple\n'),
  },
  {
    name: 'version sort',
    args: ['-V'],
    stdin: textEncoder.encode('v1.10\nv1.2\nv1.3\n'),
  },
  {
    name: 'case-insensitive unique sort',
    args: ['-f', '-u'],
    stdin: textEncoder.encode('a\nA\nbeta\n'),
  },
  {
    name: 'numeric unique sort keeps first input representative',
    args: ['-n', '-u'],
    stdin: textEncoder.encode('2\n02\napple\napple\n'),
  },
  {
    name: 'numeric unique keeps the first input representative',
    args: ['-n', '-u'],
    stdin: textEncoder.encode('10\n010\napple\napple\n'),
  },
  {
    name: 'version sort from file',
    args: ['-V', 'versions.txt'],
    files: {
      'versions.txt': 'v1.10\nv1.2\nv1.3\n',
    },
  },
];

test('sort matches host GNU sort for the supported parity corpus', async function (t): Promise<void> {
  if (!(await hasOracleUtility('sort'))) {
    t.skip('host sort is not available');
    return;
  }

  for (const parityCase of PARITY_CASES) {
    const { host, runtime } = await runSortParityCase(parityCase);

    assert.equal(runtime.exitCode, host.exitCode, `${parityCase.name}: exit code mismatch`);
    assert.equal(runtime.stderr, host.stderr, `${parityCase.name}: stderr mismatch`);
    assert.equal(
      normalizeSortText(textDecoder.decode(runtime.stdout)),
      normalizeSortText(textDecoder.decode(host.stdout)),
      `${parityCase.name}: stdout mismatch`,
    );
  }
});

async function runSortParityCase(parityCase: SortParityCase): Promise<{
  host: { exitCode: number; stderr: string; stdout: Uint8Array };
  runtime: { exitCode: number; stderr: string; stdout: Uint8Array };
}> {
  if (parityCase.files === undefined) {
    const host = await runSortOracle(parityCase.args, parityCase.stdin);
    const { result } = await runCommand('sort', parityCase.args, {
      stdin: parityCase.stdin ?? new Uint8Array(),
    });
    return { host, runtime: result };
  }

  return withOracleFixtureWorkspace(parityCase.files, async function (workspace): Promise<{
    host: { exitCode: number; stderr: string; stdout: Uint8Array };
    runtime: { exitCode: number; stderr: string; stdout: Uint8Array };
  }> {
    const host = await workspace.run('sort', mapSortArgs(workspace, parityCase.args, false));
    const runtime = await runRuntimeSort(workspace, parityCase.args);
    return { host, runtime };
  });
}

async function runSortOracle(
  args: string[],
  stdin?: Uint8Array,
): Promise<{ exitCode: number; stderr: string; stdout: Uint8Array }> {
  if (stdin === undefined) {
    return runOracleProcess('sort', args);
  }

  return runOracleProcess('sort', args, { stdin });
}

async function runRuntimeSort(
  workspace: OracleWorkspace,
  args: string[],
): Promise<{ exitCode: number; stderr: string; stdout: Uint8Array }> {
  const ctx = makeCtx({
    vfs: new NodeVFS(workspace.rootDir),
  });
  const { result } = await runCommand('sort', mapSortArgs(workspace, args, true), { ctx });
  return result;
}

function mapSortArgs(workspace: OracleWorkspace, args: string[], runtime: boolean): string[] {
  return args.map(function (arg) {
    if (arg.startsWith('-')) {
      return arg;
    }
    return runtime ? `/${arg}` : workspace.path(arg);
  });
}

function normalizeSortText(text: string): string {
  return text.replace(/\n$/, '');
}
