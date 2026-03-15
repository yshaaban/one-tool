import path from 'node:path';

import type { BuiltinCommandSelection } from '../../src/commands/index.js';
import { SimpleMemory } from '../../src/memory.js';
import { AgentCLI, type AgentCLIOutputLimits } from '../../src/runtime.js';
import { MemoryVFS } from '../../src/vfs/memory-vfs.js';
import type { VfsResourcePolicy } from '../../src/vfs/policy.js';
import { runtimeFixtureCommands } from '../../test/runtime-fixture-commands.js';
import type { AgentCLIExecutionPolicy } from '../../src/execution-policy.js';
import {
  RUNTIME_DESCRIPTION_CASES,
  RUNTIME_EXECUTION_CASES,
  type RuntimeCustomCommandId,
  type RuntimeDescriptionCase,
  type RuntimeSnapshotCase,
  type SnapshotWorld,
} from '../snapshot-cases.js';
import {
  SNAPSHOT_ROOT,
  buildAdapters,
  seedSnapshotWorld,
  serializeExecutionPolicy,
  serializeRunExecution,
  serializeSnapshotWorld,
  serializeVfsResourcePolicy,
  snapshotWorldState,
  withMockedNow,
  writeJson,
} from './shared.js';

interface SnapshotRuntimeOptions {
  world?: SnapshotWorld;
  builtinCommands?: BuiltinCommandSelection | false;
  customCommands?: RuntimeCustomCommandId[];
  outputLimits?: AgentCLIOutputLimits;
  executionPolicy?: AgentCLIExecutionPolicy;
  vfsResourcePolicy?: VfsResourcePolicy;
}

export async function writeRuntimeSnapshots(): Promise<number> {
  for (const testCase of RUNTIME_EXECUTION_CASES) {
    const payload = await snapshotRuntimeCase(testCase);
    await writeJson(path.join(SNAPSHOT_ROOT, 'runtime', 'executions', `${testCase.id}.json`), payload);
  }

  for (const testCase of RUNTIME_DESCRIPTION_CASES) {
    const payload = await snapshotRuntimeDescriptionCase(testCase);
    await writeJson(path.join(SNAPSHOT_ROOT, 'runtime', 'descriptions', `${testCase.id}.json`), payload);
  }

  return RUNTIME_EXECUTION_CASES.length + RUNTIME_DESCRIPTION_CASES.length;
}

async function snapshotRuntimeCase(testCase: RuntimeSnapshotCase): Promise<Record<string, unknown>> {
  return withMockedNow(async function (): Promise<Record<string, unknown>> {
    const runtime = await createSnapshotRuntime(testCase);
    const execution = await runtime.runDetailed(testCase.commandLine);
    const payload: Record<string, unknown> = {
      id: testCase.id,
      commandLine: testCase.commandLine,
    };
    if (testCase.world !== undefined) {
      payload.world = serializeSnapshotWorld(testCase.world);
    }
    if (testCase.builtinCommands !== undefined) {
      payload.builtinCommands = testCase.builtinCommands;
    }
    if (testCase.customCommands !== undefined) {
      payload.customCommands = testCase.customCommands;
    }
    if (testCase.outputLimits !== undefined) {
      payload.outputLimits = testCase.outputLimits;
    }
    if (testCase.executionPolicy !== undefined) {
      payload.executionPolicy = serializeExecutionPolicy(testCase.executionPolicy);
    }
    if (testCase.vfsResourcePolicy !== undefined) {
      payload.vfsResourcePolicy = serializeVfsResourcePolicy(testCase.vfsResourcePolicy);
    }
    payload.execution = serializeRunExecution(execution);
    payload.worldAfter = await snapshotWorldState(runtime.ctx.vfs, runtime.ctx.memory);

    return payload;
  });
}

async function snapshotRuntimeDescriptionCase(
  testCase: RuntimeDescriptionCase,
): Promise<Record<string, unknown>> {
  const runtimeOptions: SnapshotRuntimeOptions = {};
  if (testCase.builtinCommands !== undefined) {
    runtimeOptions.builtinCommands = testCase.builtinCommands;
  }
  if (testCase.customCommands !== undefined) {
    runtimeOptions.customCommands = testCase.customCommands;
  }
  const runtime = await createSnapshotRuntime(runtimeOptions);

  const payload: Record<string, unknown> = {
    id: testCase.id,
    variant: testCase.variant,
  };
  if (testCase.builtinCommands !== undefined) {
    payload.builtinCommands = testCase.builtinCommands;
  }
  if (testCase.customCommands !== undefined) {
    payload.customCommands = testCase.customCommands;
  }
  payload.description = runtime.buildToolDescription(testCase.variant);

  return payload;
}

async function createSnapshotRuntime(options: SnapshotRuntimeOptions): Promise<AgentCLI> {
  let vfs = new MemoryVFS();
  if (options.vfsResourcePolicy !== undefined) {
    vfs = new MemoryVFS({ resourcePolicy: options.vfsResourcePolicy });
  }
  const memory = new SimpleMemory();

  await seedSnapshotWorld(vfs, memory, options.world);
  const runtimeOptions: ConstructorParameters<typeof AgentCLI>[0] = {
    vfs,
    adapters: buildAdapters(options.world),
    memory,
  };
  if (options.builtinCommands !== undefined) {
    runtimeOptions.builtinCommands = options.builtinCommands;
  }
  if (options.customCommands !== undefined) {
    runtimeOptions.commands = runtimeFixtureCommands(options.customCommands);
  }
  if (options.outputLimits !== undefined) {
    runtimeOptions.outputLimits = options.outputLimits;
  }
  if (options.executionPolicy !== undefined) {
    runtimeOptions.executionPolicy = options.executionPolicy;
  }

  const runtime = new AgentCLI(runtimeOptions);

  await runtime.initialize();
  return runtime;
}
