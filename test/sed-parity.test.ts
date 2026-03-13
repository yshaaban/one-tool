import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { NodeVFS } from '../src/index.js';
import { textEncoder } from '../src/types.js';
import { makeCtx, runCommand } from './commands/harness.js';
import {
  hasOracleUtility,
  type OracleWorkspace,
  type OracleWorkspaceFiles,
  withOracleFixtureWorkspace,
} from './oracles/parity-harness.js';

interface SedParityCase {
  name: string;
  files: OracleWorkspaceFiles;
  args: string[];
  stdin?: Uint8Array;
  inPlacePaths?: string[];
}

const SED_PARITY_CASES: SedParityCase[] = [
  {
    name: 'basic substitution from stdin',
    files: {},
    args: ['s/ERROR/WARN/g'],
    stdin: textEncoder.encode('ERROR one\nERROR two\n'),
  },
  {
    name: 'substitute from the second match onward',
    files: {},
    args: ['s/a/A/2g'],
    stdin: textEncoder.encode('a a a\n'),
  },
  {
    name: 'addressed print with -n',
    files: {
      'app.log': 'alpha\nbeta\ngamma\n',
    },
    args: ['-n', '2p', 'app.log'],
  },
  {
    name: 'clustered -ne script option',
    files: {
      'app.log': 'alpha\nbeta\ngamma\n',
    },
    args: ['-ne', '2p', 'app.log'],
  },
  {
    name: 'insert and append',
    files: {
      'notes.txt': 'alpha\nbeta\n',
    },
    args: ['-e', '1i\\TOP', '-e', '2a\\BOTTOM', 'notes.txt'],
  },
  {
    name: 'range change',
    files: {
      'notes.txt': 'a\nb\nc\nd\n',
    },
    args: ['2,3c\\X', 'notes.txt'],
  },
  {
    name: 'next command with explicit print',
    files: {
      'numbers.txt': '1\n2\n3\n',
    },
    args: ['-n', 'n;p', 'numbers.txt'],
  },
  {
    name: 'extended regex substitution',
    files: {
      'coords.txt': 'x=10,y=20\n',
    },
    args: ['-E', 's/x=([0-9]+),y=([0-9]+)/\\2,\\1/', 'coords.txt'],
  },
  {
    name: 'script file rewrite',
    files: {
      'rewrite.sed': 's/foo/bar/\n2p\n',
      'input.txt': 'foo\nfoo\n',
    },
    args: ['-n', '-f', 'rewrite.sed', 'input.txt'],
  },
  {
    name: 'clustered -nEf script file option',
    files: {
      'rewrite.sed': 's/foo/bar/\n2p\n',
      'input.txt': 'foo\nfoo\n',
    },
    args: ['-nEfrewrite.sed', 'input.txt'],
  },
  {
    name: 'in-place edit with backup',
    files: {
      'config.env': 'REGION=us-east-1\n',
    },
    args: ['-i.bak', 's/us-east-1/us-west-2/', 'config.env'],
    inPlacePaths: ['config.env', 'config.env.bak'],
  },
];

test('sed matches host GNU sed for the supported parity corpus', async function (t): Promise<void> {
  if (!(await hasOracleUtility('sed'))) {
    t.skip('host sed is not available');
    return;
  }

  for (const parityCase of SED_PARITY_CASES) {
    const host = await withOracleFixtureWorkspace(parityCase.files, async function (workspace) {
      const result = await workspace.run(
        'sed',
        mapSedArgsForWorkspace(parityCase.args, workspace, false),
        parityCase.stdin === undefined ? {} : { stdin: parityCase.stdin },
      );
      const fileBytes = await readSedWorkspaceFiles(workspace, parityCase.inPlacePaths ?? []);
      return { result, rootDir: workspace.rootDir, fileBytes };
    });
    const runtime = await withOracleFixtureWorkspace(parityCase.files, async function (workspace) {
      const result = await runRuntimeSed(workspace, parityCase.args, parityCase.stdin);
      const fileBytes = await readSedWorkspaceFiles(workspace, parityCase.inPlacePaths ?? []);
      return { result, rootDir: workspace.rootDir, fileBytes };
    });

    assert.equal(runtime.result.exitCode, host.result.exitCode, `${parityCase.name}: exit code mismatch`);
    assert.equal(
      normalizeOracleText(runtime.result.stderr, runtime.rootDir),
      normalizeOracleText(host.result.stderr, host.rootDir),
      `${parityCase.name}: stderr mismatch`,
    );
    assert.deepEqual(
      Array.from(runtime.result.stdout),
      Array.from(host.result.stdout),
      `${parityCase.name}: stdout mismatch`,
    );

    for (const relativePath of parityCase.inPlacePaths ?? []) {
      assert.deepEqual(
        Array.from(runtime.fileBytes.get(relativePath) ?? []),
        Array.from(host.fileBytes.get(relativePath) ?? []),
        `${parityCase.name}: in-place file mismatch for ${relativePath}`,
      );
    }
  }
});

async function runRuntimeSed(
  workspace: OracleWorkspace,
  args: string[],
  stdin?: Uint8Array,
): Promise<{ stdout: Uint8Array; stderr: string; exitCode: number }> {
  const ctx = makeCtx({
    vfs: new NodeVFS(workspace.rootDir),
  });
  const mappedArgs = mapSedArgsForWorkspace(args, workspace, true);
  const { result } = await runCommand('sed', mappedArgs, {
    ctx,
    stdin: stdin ?? new Uint8Array(),
  });
  return result;
}

function mapSedArgsForWorkspace(args: string[], workspace: OracleWorkspace, runtime: boolean): string[] {
  const mapped: string[] = [];
  let parsingOptions = true;
  let scriptResolved = false;
  let collectedScriptFromFlags = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (parsingOptions && arg === '--') {
      mapped.push(arg);
      parsingOptions = false;
      continue;
    }

    if (parsingOptions && arg.startsWith('-') && arg !== '-') {
      const remappedOption = remapSedOptionArgument(arg, args[index + 1], workspace, runtime);
      if (remappedOption !== null) {
        mapped.push(remappedOption.argument);
        if (remappedOption.extraArgument !== undefined) {
          mapped.push(remappedOption.extraArgument);
        }
        if (remappedOption.consumedNext) {
          index += 1;
        }
        if (remappedOption.collectsScript) {
          collectedScriptFromFlags = true;
        }
        continue;
      }
    }

    if (!scriptResolved && !collectedScriptFromFlags) {
      mapped.push(arg);
      scriptResolved = true;
      parsingOptions = false;
      continue;
    }

    mapped.push(arg === '-' ? '-' : runtime ? toRuntimeFilePath(arg) : workspace.path(arg));
    parsingOptions = false;
  }

  return mapped;
}

function remapSedOptionArgument(
  arg: string,
  nextArg: string | undefined,
  workspace: OracleWorkspace,
  runtime: boolean,
): { argument: string; extraArgument?: string; consumedNext: boolean; collectsScript: boolean } | null {
  let rebuilt = '-';
  let scanIndex = 1;

  while (scanIndex < arg.length) {
    const flag = arg[scanIndex]!;
    if (flag === 'n' || flag === 'E') {
      rebuilt += flag;
      scanIndex += 1;
      continue;
    }
    if (flag === 'i') {
      rebuilt += arg.slice(scanIndex);
      return {
        argument: rebuilt,
        consumedNext: false,
        collectsScript: false,
      };
    }
    if (flag === 'e') {
      rebuilt += flag;
      const inlineScript = arg.slice(scanIndex + 1);
      if (inlineScript) {
        rebuilt += inlineScript;
        return {
          argument: rebuilt,
          consumedNext: false,
          collectsScript: true,
        };
      }
      return {
        argument: rebuilt,
        consumedNext: true,
        collectsScript: true,
        ...(nextArg === undefined ? {} : { extraArgument: nextArg }),
      };
    }
    if (flag === 'f') {
      rebuilt += flag;
      const inlinePath = arg.slice(scanIndex + 1);
      const scriptPath = inlinePath || nextArg;
      if (scriptPath === undefined) {
        return {
          argument: rebuilt,
          consumedNext: false,
          collectsScript: true,
        };
      }
      const mappedPath = runtime ? toRuntimeFilePath(scriptPath) : workspace.path(scriptPath);
      if (inlinePath) {
        rebuilt += mappedPath;
        return {
          argument: rebuilt,
          consumedNext: false,
          collectsScript: true,
        };
      }
      return {
        argument: rebuilt,
        extraArgument: mappedPath,
        consumedNext: true,
        collectsScript: true,
      };
    }
    return null;
  }

  return {
    argument: rebuilt,
    consumedNext: false,
    collectsScript: false,
  };
}

function toRuntimeFilePath(path: string): string {
  if (path === '-') {
    return path;
  }
  return path.startsWith('/') ? path : `/${path}`;
}

function normalizeOracleText(text: string, rootDir: string): string {
  const escapedRoot = rootDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(escapedRoot, 'g'), '');
}

async function workspaceFileBytes(workspace: OracleWorkspace, relativePath: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(workspace.path(relativePath)));
}

async function readSedWorkspaceFiles(
  workspace: OracleWorkspace,
  relativePaths: readonly string[],
): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();

  for (const relativePath of relativePaths) {
    files.set(relativePath, await workspaceFileBytes(workspace, relativePath));
  }

  return files;
}
