import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { NodeVFS, toVfsError } from '../src/index.js';

async function withNodeVfs(runTest: (vfs: NodeVFS) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'node-vfs-test-'));
  try {
    const vfs = new NodeVFS(root);
    await runTest(vfs);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('resolve clamps paths inside the root', async () => {
  await withNodeVfs(async (vfs) => {
    const resolved = vfs.resolve('/../../etc/passwd');
    assert.equal(resolved, path.join(vfs.rootDir, 'etc', 'passwd'));
  });
});

test('delete root throws', async () => {
  await withNodeVfs(async (vfs) => {
    await assert.rejects(
      async () => vfs.delete('/'),
      function (caught: unknown): boolean {
        const vfsError = toVfsError(caught);
        assert.ok(vfsError);
        assert.equal(vfsError.code, 'EROOT');
        assert.equal(vfsError.path, '/');
        return true;
      },
    );
  });
});

test('stat reports directory size as zero', async () => {
  await withNodeVfs(async (vfs) => {
    await vfs.mkdir('/dir', true);
    const info = await vfs.stat('/dir');
    assert.equal(info.isDir, true);
    assert.equal(info.size, 0);
    assert.ok(info.modifiedEpochMs > 0);
  });
});

test('copy directory into its own child throws EINVAL', async () => {
  await withNodeVfs(async (vfs) => {
    await vfs.writeBytes('/src/main.ts', new TextEncoder().encode('code'));
    await assert.rejects(() => vfs.copy('/src', '/src/sub'), /EINVAL/);
  });
});

test('move directory into its own child throws EINVAL', async () => {
  await withNodeVfs(async (vfs) => {
    await vfs.writeBytes('/src/main.ts', new TextEncoder().encode('code'));
    await assert.rejects(() => vfs.move('/src', '/src/sub'), /EINVAL/);
  });
});
