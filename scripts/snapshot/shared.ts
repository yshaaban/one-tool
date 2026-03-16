import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { CommandResult } from '../../src/types.js';
import { compareCLocaleText } from '../../src/c-locale.js';
import { SimpleMemory } from '../../src/memory.js';
import type { PipelineExecutionTrace, RunExecution } from '../../src/runtime.js';
import { DemoFetch, DemoSearch } from '../../src/testing/adapters.js';
import type { OracleTrace, ScenarioSpec } from '../../src/testing/index.js';
import { looksBinary } from '../../src/utils.js';
import type { VFS } from '../../src/vfs/interface.js';
import type { VfsResourcePolicy } from '../../src/vfs/policy.js';
import type { AgentCLIExecutionPolicy } from '../../src/execution-policy.js';
import type { SnapshotDirectoryEntry, SnapshotFileEntry, SnapshotWorld } from '../snapshot-cases.js';

interface SerializedTextFileEntry {
  kind: 'text';
  text: string;
}

interface SerializedBinaryFileEntry {
  kind: 'bytes';
  data_b64: string;
}

type SerializedRawFileEntry = SnapshotDirectoryEntry | SerializedTextFileEntry | SerializedBinaryFileEntry;

interface SerializedWorldStateFileEntry {
  path: string;
  kind: 'dir' | 'text' | 'bytes';
  text?: string;
  data_b64?: string;
}

interface SerializedMemoryItem {
  id: number;
  text: string;
  createdEpochMs: number;
  metadata: Record<string, unknown>;
}

interface SerializedCommandResult {
  stdout_b64: string;
  stdout_text?: string;
  stderr: string;
  exitCode: number;
  contentType: string;
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

export const SNAPSHOT_ROOT = path.resolve('snapshots');
export const EMPTY_STDIN = new Uint8Array();

export async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export async function writeJsonl(filePath: string, rows: unknown[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const contents =
    rows
      .map(function (row) {
        return JSON.stringify(row);
      })
      .join('\n') + '\n';
  await writeFile(filePath, contents, 'utf8');
}

export function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

export function normalizePresentationText(text: string): string {
  return text.replace(/\[exit:(-?\d+) \| [^\]]+\]$/, '[exit:$1 | 0ms]');
}

export function encodeText(value: string): Uint8Array {
  return textEncoder.encode(value);
}

export async function withMockedNow<T>(run: () => Promise<T>): Promise<T> {
  const originalNow = Date.now;
  let current = 1_700_000_000_000;

  Date.now = function (): number {
    current += 1;
    return current;
  };

  try {
    return await run();
  } finally {
    Date.now = originalNow;
  }
}

export async function seedSnapshotWorld(
  vfs: VFS,
  memory: SimpleMemory,
  world: SnapshotWorld | undefined,
): Promise<void> {
  if (world?.files !== undefined) {
    const entries = Object.entries(world.files).sort(function ([left], [right]) {
      return compareCLocaleText(left, right);
    });

    for (const [filePath, entry] of entries) {
      if (isSnapshotDirectoryEntry(entry)) {
        await vfs.mkdir(filePath, true);
        continue;
      }

      const bytes = typeof entry === 'string' ? encodeText(entry) : entry;
      await vfs.writeBytes(filePath, bytes, true);
    }
  }

  if (world?.memory !== undefined) {
    for (const item of world.memory) {
      memory.store(item);
    }
  }
}

export function buildAdapters(world: SnapshotWorld | undefined): {
  search?: DemoSearch;
  fetch?: DemoFetch;
} {
  const adapters: {
    search?: DemoSearch;
    fetch?: DemoFetch;
  } = {};

  if (world?.searchDocs !== undefined) {
    adapters.search = new DemoSearch(world.searchDocs);
  }

  if (world?.fetchResources !== undefined) {
    adapters.fetch = new DemoFetch(world.fetchResources);
  }

  return adapters;
}

export function serializeSnapshotWorld(world: SnapshotWorld): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};

  if (world.files !== undefined) {
    serialized.files = serializeRawFileEntries(world.files);
  }
  if (world.searchDocs !== undefined) {
    serialized.searchDocs = world.searchDocs;
  }
  if (world.fetchResources !== undefined) {
    serialized.fetchResources = serializeFetchResources(world.fetchResources);
  }
  if (world.memory !== undefined) {
    serialized.memory = [...world.memory];
  }
  if (world.outputLimits !== undefined) {
    serialized.outputLimits = world.outputLimits;
  }

  return serialized;
}

export async function snapshotWorldState(
  vfs: VFS,
  memory: SimpleMemory,
): Promise<{ files: SerializedWorldStateFileEntry[]; memory: SerializedMemoryItem[] }> {
  return {
    files: await snapshotVfsEntries(vfs),
    memory: snapshotMemoryItems(memory),
  };
}

export function serializeCommandResult(result: CommandResult): SerializedCommandResult {
  const stdoutBase64 = toBase64(result.stdout);

  if (!looksBinary(result.stdout) && result.stdout.length > 0) {
    return {
      stdout_b64: stdoutBase64,
      stdout_text: textDecoder.decode(result.stdout),
      stderr: result.stderr,
      exitCode: result.exitCode,
      contentType: result.contentType,
    };
  }

  return {
    stdout_b64: stdoutBase64,
    stderr: result.stderr,
    exitCode: result.exitCode,
    contentType: result.contentType,
  };
}

export function serializeRunExecution(execution: RunExecution): Record<string, unknown> {
  const presentation: Record<string, unknown> = {
    text: normalizePresentationText(execution.presentation.text),
    body: execution.presentation.body,
    stdoutMode: execution.presentation.stdoutMode,
  };
  if (execution.presentation.savedPath !== undefined) {
    presentation.savedPath = execution.presentation.savedPath;
  }
  if (execution.presentation.totalBytes !== undefined) {
    presentation.totalBytes = execution.presentation.totalBytes;
  }
  if (execution.presentation.totalLines !== undefined) {
    presentation.totalLines = execution.presentation.totalLines;
  }

  const serialized: Record<string, unknown> = {
    exitCode: execution.exitCode,
    stdout_b64: toBase64(execution.stdout),
  };
  if (!looksBinary(execution.stdout) && execution.stdout.length > 0) {
    serialized.stdout_text = textDecoder.decode(execution.stdout);
  }
  serialized.stderr = execution.stderr;
  serialized.contentType = execution.contentType;
  serialized.trace = execution.trace.map(serializePipelineExecutionTrace);
  serialized.presentation = presentation;

  return serialized;
}

export function serializeScenarioSpec(scenario: ScenarioSpec): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    id: scenario.id,
    category: scenario.category,
    description: scenario.description,
    prompt: scenario.prompt,
  };
  if (scenario.promptVariant !== undefined) {
    serialized.promptVariant = scenario.promptVariant;
  }
  serialized.maxTurns = scenario.maxTurns;
  serialized.maxToolCalls = scenario.maxToolCalls;
  if (scenario.repeats !== undefined) {
    serialized.repeats = scenario.repeats;
  }
  serialized.world = serializeSnapshotWorld(scenario.world as SnapshotWorld);
  if (scenario.oracle !== undefined) {
    serialized.oracle = scenario.oracle;
  }
  serialized.assertions = scenario.assertions;

  return serialized;
}

export function serializeOracleTrace(trace: OracleTrace): Record<string, unknown> {
  return {
    scenarioId: trace.scenarioId,
    steps: trace.steps.map(function (step) {
      return {
        command: step.command,
        output: normalizePresentationText(step.output),
        body: step.body,
        exitCode: step.exitCode,
        expectedExitCode: step.expectedExitCode,
        execution: serializeRunExecution(step.execution),
      };
    }),
    finalOutput: normalizePresentationText(trace.finalOutput),
    finalBody: trace.finalBody,
    finalExitCode: trace.finalExitCode,
  };
}

export function serializeExecutionPolicy(policy: AgentCLIExecutionPolicy): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};

  if (policy.maxMaterializedBytes !== undefined) {
    serialized.maxMaterializedBytes = policy.maxMaterializedBytes;
  }

  return serialized;
}

export function serializeVfsResourcePolicy(policy: VfsResourcePolicy): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};

  if (policy.maxFileBytes !== undefined) {
    serialized.maxFileBytes = policy.maxFileBytes;
  }
  if (policy.maxTotalBytes !== undefined) {
    serialized.maxTotalBytes = policy.maxTotalBytes;
  }
  if (policy.maxDirectoryDepth !== undefined) {
    serialized.maxDirectoryDepth = policy.maxDirectoryDepth;
  }
  if (policy.maxEntriesPerDirectory !== undefined) {
    serialized.maxEntriesPerDirectory = policy.maxEntriesPerDirectory;
  }
  if (policy.maxOutputArtifactBytes !== undefined) {
    serialized.maxOutputArtifactBytes = policy.maxOutputArtifactBytes;
  }

  return serialized;
}

export function isSnapshotDirectoryEntry(value: SnapshotFileEntry): value is SnapshotDirectoryEntry {
  return typeof value === 'object' && !(value instanceof Uint8Array) && value.kind === 'dir';
}

function serializeRawFileEntries(
  entries: Record<string, SnapshotFileEntry>,
): Record<string, SerializedRawFileEntry> {
  const serialized: Record<string, SerializedRawFileEntry> = {};

  for (const filePath of Object.keys(entries).sort(function (left, right) {
    return compareCLocaleText(left, right);
  })) {
    const entry = entries[filePath]!;
    if (isSnapshotDirectoryEntry(entry)) {
      serialized[filePath] = { kind: 'dir' };
      continue;
    }

    if (typeof entry === 'string') {
      serialized[filePath] = {
        kind: 'text',
        text: entry,
      };
      continue;
    }

    serialized[filePath] = {
      kind: 'bytes',
      data_b64: toBase64(entry),
    };
  }

  return serialized;
}

function serializeFetchResources(resources: Record<string, unknown>): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};

  for (const resource of Object.keys(resources).sort(function (left, right) {
    return compareCLocaleText(left, right);
  })) {
    serialized[resource] = serializeFetchPayload(resources[resource]);
  }

  return serialized;
}

function serializeFetchPayload(payload: unknown): unknown {
  if (payload instanceof Uint8Array) {
    return {
      kind: 'bytes',
      data_b64: toBase64(payload),
    };
  }

  if (payload === undefined) {
    return {
      kind: 'undefined',
    };
  }

  return payload;
}

async function snapshotVfsEntries(vfs: VFS): Promise<SerializedWorldStateFileEntry[]> {
  const entries: SerializedWorldStateFileEntry[] = [];

  async function walk(dirPath: string): Promise<void> {
    const children = await vfs.listdir(dirPath);
    for (const child of children) {
      const isDir = child.endsWith('/');
      const name = isDir ? child.slice(0, -1) : child;
      const fullPath = dirPath === '/' ? `/${name}` : `${dirPath}/${name}`;

      if (isDir) {
        entries.push({
          path: fullPath,
          kind: 'dir',
        });
        await walk(fullPath);
        continue;
      }

      const data = await vfs.readBytes(fullPath);
      if (looksBinary(data)) {
        entries.push({
          path: fullPath,
          kind: 'bytes',
          data_b64: toBase64(data),
        });
      } else {
        entries.push({
          path: fullPath,
          kind: 'text',
          text: textDecoder.decode(data),
        });
      }
    }
  }

  await walk('/');
  return entries;
}

function snapshotMemoryItems(memory: SimpleMemory): SerializedMemoryItem[] {
  return memory
    .recent(Number.MAX_SAFE_INTEGER)
    .slice()
    .reverse()
    .map(function (item) {
      return {
        id: item.id,
        text: item.text,
        createdEpochMs: item.createdEpochMs,
        metadata: item.metadata,
      };
    });
}

function serializePipelineExecutionTrace(trace: PipelineExecutionTrace): Record<string, unknown> {
  const serialized: Record<string, unknown> = {
    relationFromPrevious: trace.relationFromPrevious,
    executed: trace.executed,
  };

  if (trace.skippedReason !== undefined) {
    serialized.skippedReason = trace.skippedReason;
  }
  if (trace.exitCode !== undefined) {
    serialized.exitCode = trace.exitCode;
  }
  serialized.commands = trace.commands.map(function (commandTrace) {
    return {
      argv: [...commandTrace.argv],
      stdinBytes: commandTrace.stdinBytes,
      stdoutBytes: commandTrace.stdoutBytes,
      stderr: commandTrace.stderr,
      exitCode: commandTrace.exitCode,
      contentType: commandTrace.contentType,
    };
  });

  return serialized;
}
