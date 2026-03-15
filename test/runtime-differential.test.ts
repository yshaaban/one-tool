import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

import type { BuiltinCommandSelection } from '../src/commands/index.js';
import type { AgentCLIExecutionPolicy } from '../src/execution-policy.js';
import { SimpleMemory } from '../src/memory.js';
import { AgentCLI, type AgentCLIOutputLimits } from '../src/runtime.js';
import { MemoryVFS } from '../src/vfs/memory-vfs.js';
import type { VfsResourcePolicy } from '../src/vfs/policy.js';
import { runtimeFixtureCommands, type RuntimeFixtureCommandId } from './runtime-fixture-commands.js';
import {
  buildAdapters,
  serializeRunExecution,
  snapshotWorldState,
  withMockedNow,
} from '../scripts/snapshot/shared.js';
import { runPythonDifferentialDriver } from './differential/python-driver.js';
import {
  type DifferentialSnapshotWorld,
  type SerializedExecutionPolicy,
  deserializeExecutionPolicy,
  deserializeSnapshotWorld,
  loadJsonRecords,
  seedWorldFromRecord,
} from './differential/snapshot-records.js';

interface RuntimeExecutionRecord {
  id: string;
  commandLine: string;
  world?: DifferentialSnapshotWorld;
  builtinCommands?: BuiltinCommandSelection | false;
  customCommands?: RuntimeFixtureCommandId[];
  outputLimits?: AgentCLIOutputLimits;
  executionPolicy?: SerializedExecutionPolicy;
  vfsResourcePolicy?: {
    maxFileBytes?: number;
    maxTotalBytes?: number;
    maxDirectoryDepth?: number;
    maxEntriesPerDirectory?: number;
    maxOutputArtifactBytes?: number;
  };
  execution: Record<string, unknown>;
  worldAfter: Record<string, unknown>;
}

interface RuntimeDescriptionRecord {
  id: string;
  variant: 'full-tool-description' | 'minimal-tool-description' | 'terse';
  world?: DifferentialSnapshotWorld;
  builtinCommands?: BuiltinCommandSelection | false;
  customCommands?: RuntimeFixtureCommandId[];
  description: string;
}

interface DifferentialRuntimeExecutionResult {
  execution: Record<string, unknown>;
  worldAfter: Record<string, unknown>;
}

interface PythonRuntimeExecutionBatchResponse {
  results: DifferentialRuntimeExecutionResult[];
}

interface DifferentialRuntimeDescriptionResult {
  description: string;
}

interface PythonRuntimeDescriptionBatchResponse {
  results: DifferentialRuntimeDescriptionResult[];
}

const RUNTIME_EXECUTION_ROOT = path.resolve('snapshots/runtime/executions');
const RUNTIME_DESCRIPTION_ROOT = path.resolve('snapshots/runtime/descriptions');

test('runtime execution snapshots stay in parity between TypeScript and Python', async function (t): Promise<void> {
  const records = await loadRuntimeExecutionRecords();
  const python = await runPythonDifferentialDriver<
    { kind: 'runtime-execution-records'; records: RuntimeExecutionRecord[] },
    PythonRuntimeExecutionBatchResponse
  >({
    kind: 'runtime-execution-records',
    records,
  });

  assert.equal(python.results.length, records.length, 'python runtime differential returned unexpected case count');

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    const pythonResult = python.results[index]!;

    await t.test(record.id, async function (): Promise<void> {
      const typescriptResult = await runTypescriptRuntimeExecutionRecord(record);

      assert.deepEqual(typescriptResult, pythonResult, 'typescript/python runtime differential mismatch');
      assert.deepEqual(typescriptResult.execution, record.execution, 'typescript runtime execution drifted from committed snapshot');
      assert.deepEqual(typescriptResult.worldAfter, record.worldAfter, 'typescript runtime worldAfter drifted from committed snapshot');
    });
  }
});

test('runtime description snapshots stay in parity between TypeScript and Python', async function (t): Promise<void> {
  const records = await loadRuntimeDescriptionRecords();
  const python = await runPythonDifferentialDriver<
    { kind: 'runtime-description-records'; records: RuntimeDescriptionRecord[] },
    PythonRuntimeDescriptionBatchResponse
  >({
    kind: 'runtime-description-records',
    records,
  });

  assert.equal(python.results.length, records.length, 'python runtime description differential returned unexpected case count');

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]!;
    const pythonResult = python.results[index]!;

    await t.test(record.id, async function (): Promise<void> {
      const typescriptResult = await runTypescriptRuntimeDescriptionRecord(record);

      assert.deepEqual(typescriptResult, pythonResult, 'typescript/python runtime description differential mismatch');
      assert.deepEqual(typescriptResult.description, record.description, 'typescript tool description drifted from committed snapshot');
    });
  }
});

async function loadRuntimeExecutionRecords(): Promise<RuntimeExecutionRecord[]> {
  return loadJsonRecords<RuntimeExecutionRecord>(RUNTIME_EXECUTION_ROOT, 'runtime execution');
}

async function loadRuntimeDescriptionRecords(): Promise<RuntimeDescriptionRecord[]> {
  return loadJsonRecords<RuntimeDescriptionRecord>(RUNTIME_DESCRIPTION_ROOT, 'runtime description');
}

async function runTypescriptRuntimeExecutionRecord(
  record: RuntimeExecutionRecord,
): Promise<DifferentialRuntimeExecutionResult> {
  return withMockedNow(async function (): Promise<DifferentialRuntimeExecutionResult> {
    const runtime = await createSnapshotRuntime(record);
    const execution = await runtime.runDetailed(record.commandLine);

    return {
      execution: serializeRunExecution(execution) as unknown as Record<string, unknown>,
      worldAfter: await snapshotWorldState(runtime.ctx.vfs, runtime.ctx.memory),
    };
  });
}

async function runTypescriptRuntimeDescriptionRecord(
  record: RuntimeDescriptionRecord,
): Promise<DifferentialRuntimeDescriptionResult> {
  const runtime = await createSnapshotRuntime(record);
  return {
    description: runtime.buildToolDescription(record.variant),
  };
}

async function createSnapshotRuntime(
  record: RuntimeExecutionRecord | RuntimeDescriptionRecord,
): Promise<AgentCLI> {
  const resourcePolicy =
    'vfsResourcePolicy' in record && record.vfsResourcePolicy !== undefined
      ? ({ ...record.vfsResourcePolicy } satisfies VfsResourcePolicy)
      : undefined;
  const vfs = resourcePolicy === undefined ? new MemoryVFS() : new MemoryVFS({ resourcePolicy });
  const memory = new SimpleMemory();

  await seedWorldFromRecord(vfs, memory, record.world);
  const runtimeOptions: ConstructorParameters<typeof AgentCLI>[0] = {
    vfs,
    adapters: buildAdapters(deserializeSnapshotWorld(record.world)),
    memory,
  };
  if (record.builtinCommands !== undefined) {
    runtimeOptions.builtinCommands = record.builtinCommands;
  }
  if (record.customCommands !== undefined) {
    runtimeOptions.commands = runtimeFixtureCommands(record.customCommands);
  }
  if ('outputLimits' in record && record.outputLimits !== undefined) {
    runtimeOptions.outputLimits = record.outputLimits;
  }
  if ('executionPolicy' in record && record.executionPolicy !== undefined) {
    const executionPolicy = deserializeExecutionPolicy(record.executionPolicy);
    if (executionPolicy !== undefined) {
      runtimeOptions.executionPolicy = executionPolicy;
    }
  }

  const runtime = new AgentCLI(runtimeOptions);
  await runtime.initialize();
  return runtime;
}
