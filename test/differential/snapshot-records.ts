import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { AgentCLIExecutionPolicy } from '../../src/execution-policy.js';
import { SimpleMemory } from '../../src/memory.js';
import { compareCLocaleText } from '../../src/utils.js';
import { MemoryVFS } from '../../src/vfs/memory-vfs.js';
import type { VfsResourcePolicy } from '../../src/vfs/index.js';

export interface SerializedTextWorldEntry {
  kind: 'text';
  text: string;
}

export interface SerializedBytesWorldEntry {
  kind: 'bytes';
  data_b64: string;
}

export interface SerializedDirectoryWorldEntry {
  kind: 'dir';
}

export type SerializedWorldEntry = SerializedTextWorldEntry | SerializedBytesWorldEntry | SerializedDirectoryWorldEntry;

export interface DifferentialSnapshotWorld {
  files?: Record<string, SerializedWorldEntry>;
  searchDocs?: unknown[];
  fetchResources?: Record<string, unknown>;
  memory?: string[];
  outputLimits?: Record<string, unknown>;
}

export interface SerializedExecutionPolicy {
  maxMaterializedBytes?: number;
}

export interface SerializedVfsResourcePolicy {
  maxDirectoryDepth?: number;
  maxEntriesPerDirectory?: number;
  maxFileBytes?: number;
  maxOutputArtifactBytes?: number;
  maxTotalBytes?: number;
}

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
  raw: SerializedExecutionPolicy | undefined,
): AgentCLIExecutionPolicy | undefined {
  if (raw === undefined) {
    return undefined;
  }

  if (raw.maxMaterializedBytes === undefined) {
    return {};
  }

  return { maxMaterializedBytes: raw.maxMaterializedBytes };
}

export function deserializeVfsResourcePolicy(
  raw: SerializedVfsResourcePolicy | undefined,
): VfsResourcePolicy | undefined {
  if (raw === undefined) {
    return undefined;
  }

  return { ...raw };
}

export function deserializeSnapshotWorld(raw: DifferentialSnapshotWorld | undefined): Record<string, unknown> | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const world: Record<string, unknown> = {};
  if (raw.searchDocs !== undefined) {
    world.searchDocs = raw.searchDocs;
  }
  if (raw.fetchResources !== undefined) {
    world.fetchResources = deserializeFetchResources(raw.fetchResources);
  }
  return world;
}

export async function seedWorldFromRecord(
  vfs: MemoryVFS,
  memory: SimpleMemory,
  raw: DifferentialSnapshotWorld | undefined,
): Promise<void> {
  if (raw === undefined) {
    return;
  }

  if (raw.files !== undefined) {
    const filePaths = Object.keys(raw.files).sort(function (left, right): number {
      return compareCLocaleText(left, right);
    });

    for (const filePath of filePaths) {
      const entry = raw.files[filePath]!;
      if (entry.kind === 'dir') {
        await vfs.mkdir(filePath, true);
        continue;
      }
      if (entry.kind === 'text') {
        await vfs.writeBytes(filePath, Buffer.from(entry.text, 'utf8'), true);
        continue;
      }
      await vfs.writeBytes(filePath, decodeBase64(entry.data_b64), true);
    }
  }

  if (raw.memory !== undefined) {
    for (const item of raw.memory) {
      memory.store(item);
    }
  }
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
