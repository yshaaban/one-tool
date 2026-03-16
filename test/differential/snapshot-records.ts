import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { AgentCLIExecutionPolicy } from '../../src/execution-policy.js';
import { compareCLocaleText } from '../../src/c-locale.js';
import { SimpleMemory } from '../../src/memory.js';
import { MemoryVFS } from '../../src/vfs/memory-vfs.js';
import type { VfsResourcePolicy } from '../../src/vfs/index.js';
import {
  seedSnapshotWorld,
  type SerializedSnapshotWorld,
  type SerializedSnapshotWorldEntry,
} from '../../scripts/snapshot/shared.js';
import type { SnapshotFileEntry, SnapshotWorld } from '../../scripts/snapshot-cases.js';

export type DifferentialSnapshotWorld = SerializedSnapshotWorld;

export async function loadJsonRecords<T>(rootDir: string, label: string): Promise<T[]> {
  const snapshotPaths = await collectJsonFiles(rootDir);
  assert.ok(snapshotPaths.length > 0, `expected committed ${label} snapshots in ${rootDir}`);

  const records: T[] = [];
  for (const snapshotPath of snapshotPaths) {
    const raw = await readFile(snapshotPath, 'utf8');
    records.push(JSON.parse(raw) as T);
  }

  return records;
}

export function deserializeExecutionPolicy(
  raw: AgentCLIExecutionPolicy | undefined,
): AgentCLIExecutionPolicy | undefined {
  if (raw === undefined) {
    return undefined;
  }
  return { ...raw };
}

export function deserializeVfsResourcePolicy(
  raw: VfsResourcePolicy | undefined,
): VfsResourcePolicy | undefined {
  if (raw === undefined) {
    return undefined;
  }

  return { ...raw };
}

export function deserializeSnapshotWorld(raw: DifferentialSnapshotWorld | undefined): SnapshotWorld | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const world: SnapshotWorld = {};
  if (raw.files !== undefined) {
    world.files = deserializeRawFileEntries(raw.files);
  }
  if (raw.searchDocs !== undefined) {
    world.searchDocs = raw.searchDocs;
  }
  if (raw.fetchResources !== undefined) {
    world.fetchResources = deserializeFetchResources(raw.fetchResources);
  }
  if (raw.memory !== undefined) {
    world.memory = [...raw.memory];
  }
  if (raw.outputLimits !== undefined) {
    world.outputLimits = raw.outputLimits;
  }
  return world;
}

export async function seedWorldFromRecord(
  vfs: MemoryVFS,
  memory: SimpleMemory,
  raw: DifferentialSnapshotWorld | undefined,
): Promise<void> {
  await seedSnapshotWorld(vfs, memory, deserializeSnapshotWorld(raw));
}

export function decodeBase64(value: string): Uint8Array {
  if (value === '') {
    return new Uint8Array();
  }
  return Uint8Array.from(Buffer.from(value, 'base64'));
}

async function collectJsonFiles(rootDir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(dirPath: string): Promise<void> {
    const entries = await readdir(dirPath, { withFileTypes: true });
    entries.sort(function (left, right): number {
      return compareCLocaleText(left.name, right.name);
    });

    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(entryPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.json')) {
        results.push(entryPath);
      }
    }
  }

  await walk(rootDir);
  return results;
}

function deserializeFetchResources(raw: Record<string, unknown>): Record<string, unknown> {
  const resources: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    resources[key] = deserializeFetchPayload(value);
  }

  return resources;
}

function deserializeFetchPayload(value: unknown): unknown {
  if (Array.isArray(value) || value === null || typeof value !== 'object') {
    return value;
  }

  if ('kind' in value && value.kind === 'bytes' && 'data_b64' in value && typeof value.data_b64 === 'string') {
    return decodeBase64(value.data_b64);
  }
  if ('kind' in value && value.kind === 'undefined') {
    return undefined;
  }

  const payload: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    payload[key] = deserializeFetchPayload(nested);
  }
  return payload;
}

function deserializeRawFileEntries(
  raw: Record<string, SerializedSnapshotWorldEntry>,
): Record<string, SnapshotFileEntry> {
  const files: Record<string, SnapshotFileEntry> = {};

  for (const [filePath, entry] of Object.entries(raw).sort(function ([left], [right]): number {
    return compareCLocaleText(left, right);
  })) {
    switch (entry.kind) {
      case 'dir':
        files[filePath] = { kind: 'dir' };
        break;
      case 'text':
        files[filePath] = entry.text;
        break;
      case 'bytes':
        files[filePath] = decodeBase64(entry.data_b64);
        break;
      default: {
        const _exhaustive: never = entry;
        return _exhaustive;
      }
    }
  }

  return files;
}
