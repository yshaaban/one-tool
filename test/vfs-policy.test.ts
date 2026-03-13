import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import 'fake-indexeddb/auto';

import {
  BrowserVFS,
  MemoryVFS,
  NodeVFS,
  type VFS,
  type VfsResourcePolicy,
  toVfsError,
} from '../src/index.js';

interface VfsHandle {
  vfs: VFS;
  cleanup(): Promise<void>;
}

async function createNodeVfs(policy: VfsResourcePolicy): Promise<VfsHandle> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'one-tool-policy-'));
  return {
    vfs: new NodeVFS(root, { resourcePolicy: policy }),
    async cleanup(): Promise<void> {
      await rm(root, { recursive: true, force: true });
    },
  };
}

let browserCounter = 0;

async function createBrowserVfs(policy: VfsResourcePolicy): Promise<VfsHandle> {
  const dbName = `policy-browser-db-${Date.now()}-${browserCounter++}`;
  const vfs = await BrowserVFS.open(dbName, { resourcePolicy: policy });
  return {
    vfs,
    async cleanup(): Promise<void> {
      vfs.close();
      await BrowserVFS.destroy(dbName);
    },
  };
}

function createMemoryVfs(policy: VfsResourcePolicy): Promise<VfsHandle> {
  return Promise.resolve({
    vfs: new MemoryVFS({ resourcePolicy: policy }),
    async cleanup(): Promise<void> {},
  });
}

const backends = [
  { name: 'NodeVFS', create: createNodeVfs },
  { name: 'MemoryVFS', create: createMemoryVfs },
  { name: 'BrowserVFS', create: createBrowserVfs },
] as const;

for (const backend of backends) {
  test(`${backend.name}: maxFileBytes rejects oversized writes with typed details`, async function (): Promise<void> {
    const handle = await backend.create({ maxFileBytes: 3 });
    try {
      await assert.rejects(
        async () => handle.vfs.writeBytes('/notes/report.txt', new TextEncoder().encode('hello')),
        function (caught: unknown): boolean {
          const vfsError = toVfsError(caught);
          assert.ok(vfsError);
          assert.equal(vfsError.code, 'ERESOURCE_LIMIT');
          assert.equal(vfsError.path, '/notes/report.txt');
          assert.equal(vfsError.details?.limitKind, 'maxFileBytes');
          assert.equal(vfsError.details?.limit, 3);
          assert.equal(vfsError.details?.actual, 5);
          return true;
        },
      );
    } finally {
      await handle.cleanup();
    }
  });

  test(`${backend.name}: maxTotalBytes rejects writes that exceed total storage`, async function (): Promise<void> {
    const handle = await backend.create({ maxTotalBytes: 5 });
    try {
      await handle.vfs.writeBytes('/a.txt', new TextEncoder().encode('abc'));
      await assert.rejects(
        async () => handle.vfs.writeBytes('/b.txt', new TextEncoder().encode('def')),
        function (caught: unknown): boolean {
          const vfsError = toVfsError(caught);
          assert.ok(vfsError);
          assert.equal(vfsError.code, 'ERESOURCE_LIMIT');
          assert.equal(vfsError.details?.limitKind, 'maxTotalBytes');
          assert.equal(vfsError.details?.limit, 5);
          assert.equal(vfsError.details?.actual, 6);
          return true;
        },
      );
    } finally {
      await handle.cleanup();
    }
  });

  test(`${backend.name}: maxDirectoryDepth rejects overly deep directory trees`, async function (): Promise<void> {
    const handle = await backend.create({ maxDirectoryDepth: 2 });
    try {
      await assert.rejects(
        async () => handle.vfs.writeBytes('/a/b/c/file.txt', new TextEncoder().encode('x')),
        function (caught: unknown): boolean {
          const vfsError = toVfsError(caught);
          assert.ok(vfsError);
          assert.equal(vfsError.code, 'ERESOURCE_LIMIT');
          assert.equal(vfsError.details?.limitKind, 'maxDirectoryDepth');
          assert.equal(vfsError.details?.limit, 2);
          assert.equal(vfsError.details?.actual, 3);
          return true;
        },
      );
    } finally {
      await handle.cleanup();
    }
  });

  test(`${backend.name}: maxEntriesPerDirectory rejects directory fanout that exceeds the cap`, async function (): Promise<void> {
    const handle = await backend.create({ maxEntriesPerDirectory: 1 });
    try {
      await handle.vfs.writeBytes('/first.txt', new TextEncoder().encode('a'));
      await assert.rejects(
        async () => handle.vfs.writeBytes('/second.txt', new TextEncoder().encode('b')),
        function (caught: unknown): boolean {
          const vfsError = toVfsError(caught);
          assert.ok(vfsError);
          assert.equal(vfsError.code, 'ERESOURCE_LIMIT');
          assert.equal(vfsError.path, '/');
          assert.equal(vfsError.details?.limitKind, 'maxEntriesPerDirectory');
          assert.equal(vfsError.details?.limit, 1);
          assert.equal(vfsError.details?.actual, 2);
          return true;
        },
      );
    } finally {
      await handle.cleanup();
    }
  });

  test(`${backend.name}: maxOutputArtifactBytes rejects oversized runtime spill artifacts`, async function (): Promise<void> {
    const handle = await backend.create({ maxOutputArtifactBytes: 2 });
    try {
      await assert.rejects(
        async () =>
          handle.vfs.writeBytes('/.system/cmd-output/cmd-0001.txt', new TextEncoder().encode('abc')),
        function (caught: unknown): boolean {
          const vfsError = toVfsError(caught);
          assert.ok(vfsError);
          assert.equal(vfsError.code, 'ERESOURCE_LIMIT');
          assert.equal(vfsError.path, '/.system/cmd-output/cmd-0001.txt');
          assert.equal(vfsError.details?.limitKind, 'maxOutputArtifactBytes');
          assert.equal(vfsError.details?.limit, 2);
          assert.equal(vfsError.details?.actual, 3);
          return true;
        },
      );
    } finally {
      await handle.cleanup();
    }
  });
}
