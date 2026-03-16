import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import { createCommandRegistry } from '../src/commands/index.js';
import { resolveExecutionPolicy } from '../src/execution-policy.js';
import { SimpleMemory } from '../src/memory.js';
import { createTestCommandContext, runRegisteredCommand } from '../src/testing/index.js';
import { MemoryVFS } from '../src/vfs/memory-vfs.js';
import {
  EMPTY_STDIN,
  buildAdapters,
  serializeCommandResult,
  snapshotWorldState,
  withMockedNow,
} from '../scripts/snapshot/shared.js';
import { runPythonDifferentialDriver } from './differential/python-driver.js';
import {
  type DifferentialSnapshotWorld,
  type SerializedExecutionPolicy,
  type SerializedVfsResourcePolicy,
  decodeBase64,
  deserializeExecutionPolicy,
  deserializeSnapshotWorld,
  deserializeVfsResourcePolicy,
  loadJsonRecords,
  seedWorldFromRecord,
} from './differential/snapshot-records.js';

interface CommandSnapshotRecord {
  id: string;
  command: string;
  args: string[];
  stdin_b64: string;
  world?: DifferentialSnapshotWorld;
  executionPolicy?: SerializedExecutionPolicy;
  vfsResourcePolicy?: SerializedVfsResourcePolicy;
  result: Record<string, unknown>;
  worldAfter: Record<string, unknown>;
}

interface DifferentialCommandCaseResult {
  result: Record<string, unknown>;
  worldAfter: Record<string, unknown>;
}

interface PythonCommandCaseBatchResponse {
  results: DifferentialCommandCaseResult[];
}

const SNAPSHOT_COMMAND_ROOT = path.resolve('snapshots/commands');

test('command snapshots stay in parity between TypeScript and Python', async function (t): Promise<void> {
  const records = await loadCommandSnapshotRecords();
  const python = await runPythonDifferentialDriver<
    { kind: 'command-snapshot-records'; records: CommandSnapshotRecord[] },
    PythonCommandCaseBatchResponse
  >({
    kind: 'command-snapshot-records',
    records,
  });

  assert.equal(python.results.length, records.length, 'python differential driver returned unexpected case count');

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    const pythonResult = python.results[index]!;

    await t.test(`${record.command}:${record.id}`, async function (): Promise<void> {
      const typescriptResult = await runTypescriptCommandSnapshotRecord(record);

      assert.deepEqual(typescriptResult, pythonResult, 'typescript/python differential mismatch');
      assert.deepEqual(typescriptResult.result, record.result, 'typescript result drifted from committed snapshot');
      assert.deepEqual(typescriptResult.worldAfter, record.worldAfter, 'typescript worldAfter drifted from committed snapshot');
    });
  }
});

async function loadCommandSnapshotRecords(): Promise<CommandSnapshotRecord[]> {
  return loadJsonRecords<CommandSnapshotRecord>(SNAPSHOT_COMMAND_ROOT, 'command');
}

async function runTypescriptCommandSnapshotRecord(record: CommandSnapshotRecord): Promise<DifferentialCommandCaseResult> {
  return withMockedNow(async function (): Promise<DifferentialCommandCaseResult> {
    const resourcePolicy = deserializeVfsResourcePolicy(
      record.vfsResourcePolicy,
    );
    const vfs = resourcePolicy === undefined ? new MemoryVFS() : new MemoryVFS({ resourcePolicy });
    const memory = new SimpleMemory();
    const ctx = createTestCommandContext({
      registry: createCommandRegistry(),
      vfs,
      adapters: buildAdapters(deserializeSnapshotWorld(record.world)),
      memory,
      executionPolicy: resolveExecutionPolicy(deserializeExecutionPolicy(record.executionPolicy)),
      outputDir: '/.system/cmd-output',
      outputCounter: 0,
    });

    await seedWorldFromRecord(vfs, memory, record.world);
    const stdin = decodeBase64(record.stdin_b64);
    const { result } = await runRegisteredCommand(record.command, record.args, {
      ctx,
      stdin: stdin.length === 0 ? EMPTY_STDIN : stdin,
    });

    return {
      result: serializeCommandResult(result) as unknown as Record<string, unknown>,
      worldAfter: await snapshotWorldState(vfs, memory),
    };
  });
}
