import path from 'node:path';

import { createCommandRegistry, type CommandSpec } from '../../src/commands/index.js';
import { resolveExecutionPolicy } from '../../src/execution-policy.js';
import { SimpleMemory } from '../../src/memory.js';
import { createTestCommandContext, runRegisteredCommand } from '../../src/testing/index.js';
import { MemoryVFS } from '../../src/vfs/memory-vfs.js';
import type { CommandSnapshotCase, SnapshotWorld } from '../snapshot-cases.js';
import { COMMAND_EXTRA_CASES, DEFAULT_ADAPTER_WORLD } from '../snapshot-cases.js';
import {
  EMPTY_STDIN,
  SNAPSHOT_ROOT,
  buildAdapters,
  encodeText,
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
  const cases = [...buildConformanceCommandCases(), ...COMMAND_EXTRA_CASES];
  validateUniqueCaseIds(cases);

  for (const testCase of cases) {
    const payload = await snapshotCommandCase(testCase);
    const snapshotGroup = testCase.snapshotGroup ?? testCase.commandName;
    await writeJson(path.join(SNAPSHOT_ROOT, 'commands', snapshotGroup, `${testCase.id}.json`), payload);
  }

  return cases.length;
}

function buildConformanceCommandCases(): CommandSnapshotCase[] {
  const registry = createCommandRegistry();
  const cases: CommandSnapshotCase[] = [];
  const hasHelp = registry.has('help');

  for (const spec of registry.all()) {
    const representativeArgs = [...(spec.conformanceArgs ?? [])];
    const representativeWorld = representativeWorldFor(spec);

    cases.push({
      id: 'conformance-representative',
      commandName: spec.name,
      args: representativeArgs,
      ...(representativeWorld === undefined ? {} : { world: representativeWorld }),
    });

    if (hasHelp) {
      cases.push({
        id: 'conformance-help-entry',
        commandName: 'help',
        snapshotGroup: spec.name,
        args: [spec.name],
      });
    }

    if (spec.acceptsStdin === false) {
      cases.push({
        id: 'conformance-stdin-rejection',
        commandName: spec.name,
        args: representativeArgs,
        stdin: encodeText('unwanted stdin'),
        ...(representativeWorld === undefined ? {} : { world: representativeWorld }),
      });
    }

    if ((spec.minArgs ?? 0) > 0) {
      cases.push({
        id: 'conformance-too-few-args',
        commandName: spec.name,
        args: tooFewArgsFor(spec),
      });
    }

    if (spec.maxArgs !== undefined) {
      cases.push({
        id: 'conformance-too-many-args',
        commandName: spec.name,
        args: tooManyArgsFor(spec),
      });
    }

    if (spec.requiresAdapter !== undefined) {
      cases.push({
        id: `conformance-missing-${spec.requiresAdapter}-adapter`,
        commandName: spec.name,
        args: adapterArgsFor(spec),
      });
    }
  }

  return cases;
}

function representativeWorldFor(spec: CommandSpec): SnapshotWorld | undefined {
  if (spec.requiresAdapter === undefined) {
    return undefined;
  }

  return DEFAULT_ADAPTER_WORLD;
}

function adapterArgsFor(spec: CommandSpec): string[] {
  if (spec.conformanceArgs !== undefined && spec.conformanceArgs.length > 0) {
    return [...spec.conformanceArgs];
  }

  const count = Math.max(spec.minArgs ?? 0, 1);
  return Array.from({ length: count }, function (_, index) {
    return `arg${index}`;
  });
}

function tooFewArgsFor(spec: CommandSpec): string[] {
  const count = Math.max((spec.minArgs ?? 0) - 1, 0);
  return Array.from({ length: count }, function (_, index) {
    return `arg${index}`;
  });
}

function tooManyArgsFor(spec: CommandSpec): string[] {
  const count = (spec.maxArgs ?? 0) + 1;
  return Array.from({ length: count }, function (_, index) {
    return `arg${index}`;
  });
}

function validateUniqueCaseIds(cases: CommandSnapshotCase[]): void {
  const seen = new Set<string>();

  for (const testCase of cases) {
    const snapshotGroup = testCase.snapshotGroup ?? testCase.commandName;
    const key = `${snapshotGroup}:${testCase.id}`;
    if (seen.has(key)) {
      throw new Error(`duplicate command snapshot case: ${key}`);
    }
    seen.add(key);
  }
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
