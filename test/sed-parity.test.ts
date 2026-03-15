import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { NodeVFS } from '../src/index.js';
import { makeCtx, runCommand } from './commands/harness.js';
import {
  hasOracleUtility,
  type OracleWorkspace,
  withOracleFixtureWorkspace,
} from './oracles/parity-harness.js';
import { SED_PARITY_CASES, mapSedFixtureArgs } from './parity-cases/sed.js';

test('sed matches host GNU sed for the supported parity corpus', async function (t): Promise<void> {
  if (!(await hasOracleUtility('sed'))) {
    t.skip('host sed is not available');
    return;
  }

  for (const parityCase of SED_PARITY_CASES) {
    const host = await withOracleFixtureWorkspace(parityCase.files, async function (workspace) {
      const result = await workspace.run(
        'sed',
        mapSedFixtureArgs(parityCase.args, function (filePath) {
          return workspace.path(filePath);
        }),
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
  const mappedArgs = mapSedFixtureArgs(args, toRuntimeFilePath);
  const { result } = await runCommand('sed', mappedArgs, {
    ctx,
    stdin: stdin ?? new Uint8Array(),
  });
  return result;
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
