import path from 'node:path';

import { createCommandRegistry } from '../../src/commands/index.js';
import { resolveExecutionPolicy } from '../../src/execution-policy.js';
import { SimpleMemory } from '../../src/memory.js';
import { createTestCommandContext, runRegisteredCommand } from '../../src/testing/index.js';
import { MemoryVFS } from '../../src/vfs/memory-vfs.js';
import { buildSnapshotCommandCases } from '../command-cases.js';
import type { CommandSnapshotCase } from '../snapshot-cases.js';
import {
  EMPTY_STDIN,
  SNAPSHOT_ROOT,
  buildAdapters,
  seedSnapshotWorld,
  serializeCommandResult,
  serializeExecutionPolicy,
  serializeSnapshotWorld,
  serializeVfsResourcePolicy,
  snapshotWorldState,
  toBase64,
  withMockedNow,
  writeJson,
} from './shared.js';

export async function writeCommandSnapshots(): Promise<number> {
  const cases = buildSnapshotCommandCases();

  for (const testCase of cases) {
    const payload = await snapshotCommandCase(testCase);
    const snapshotGroup = testCase.snapshotGroup ?? testCase.commandName;
    await writeJson(path.join(SNAPSHOT_ROOT, 'commands', snapshotGroup, `${testCase.id}.json`), payload);
  }

  return cases.length;
}

async function snapshotCommandCase(testCase: CommandSnapshotCase): Promise<Record<string, unknown>> {
  return withMockedNow(async function (): Promise<Record<string, unknown>> {
    let vfs = new MemoryVFS();
    if (testCase.vfsResourcePolicy !== undefined) {
      vfs = new MemoryVFS({ resourcePolicy: testCase.vfsResourcePolicy });
    }
    const ctx = createTestCommandContext({
      registry: createCommandRegistry(),
      vfs,
      adapters: buildAdapters(testCase.world),
      memory: new SimpleMemory(),
      executionPolicy: resolveExecutionPolicy(testCase.executionPolicy),
      outputDir: '/.system/cmd-output',
      outputCounter: 0,
    });

    await seedSnapshotWorld(ctx.vfs, ctx.memory, testCase.world);
    const stdin = testCase.stdin ?? EMPTY_STDIN;
    const { result } = await runRegisteredCommand(testCase.commandName, testCase.args, {
      ctx,
      stdin,
    });
    const payload: Record<string, unknown> = {
      id: testCase.id,
      command: testCase.commandName,
    };
    if (testCase.snapshotGroup !== undefined) {
      payload.snapshotGroup = testCase.snapshotGroup;
    }
    payload.args = [...testCase.args];
    payload.stdin_b64 = toBase64(stdin);
    if (testCase.world !== undefined) {
      payload.world = serializeSnapshotWorld(testCase.world);
    }
    if (testCase.executionPolicy !== undefined) {
      payload.executionPolicy = serializeExecutionPolicy(testCase.executionPolicy);
    }
    if (testCase.vfsResourcePolicy !== undefined) {
      payload.vfsResourcePolicy = serializeVfsResourcePolicy(testCase.vfsResourcePolicy);
    }
    payload.result = serializeCommandResult(result);
    payload.worldAfter = await snapshotWorldState(ctx.vfs, ctx.memory);

    return payload;
  });
}
