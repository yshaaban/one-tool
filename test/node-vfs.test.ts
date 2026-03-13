import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';

import { AgentCLI, NodeVFS, toVfsError } from '../src/index.js';

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

test('NodeVFS rejects reading through symlinked files', async function (): Promise<void> {
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'node-vfs-outside-'));
  try {
    await withNodeVfs(async (vfs) => {
      await writeFile(path.join(outsideRoot, 'secret.txt'), 'secret');
      await symlink(path.join(outsideRoot, 'secret.txt'), path.join(vfs.rootDir, 'secret-link.txt'));

      await assert.rejects(
        async () => vfs.readBytes('/secret-link.txt'),
        function (caught: unknown): boolean {
          const vfsError = toVfsError(caught);
          assert.ok(vfsError);
          assert.equal(vfsError.code, 'EESCAPE');
          assert.equal(vfsError.path, '/secret-link.txt');
          return true;
        },
      );

      assert.deepEqual(await vfs.listdir('/'), []);
    });
  } finally {
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test('NodeVFS rejects writes through symlinked parent directories', async function (): Promise<void> {
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'node-vfs-outside-'));
  try {
    await mkdir(path.join(outsideRoot, 'linked-dir'), { recursive: true });
    await withNodeVfs(async (vfs) => {
      await symlink(path.join(outsideRoot, 'linked-dir'), path.join(vfs.rootDir, 'linked'));

      await assert.rejects(
        async () => vfs.writeBytes('/linked/report.txt', new TextEncoder().encode('hello')),
        function (caught: unknown): boolean {
          const vfsError = toVfsError(caught);
          assert.ok(vfsError);
          assert.equal(vfsError.code, 'EESCAPE');
          assert.equal(vfsError.path, '/linked');
          return true;
        },
      );
    });
  } finally {
    await rm(outsideRoot, { recursive: true, force: true });
  }
});

test('NodeVFS surfaces symlink escapes as command errors instead of internal runtime failures', async function (): Promise<void> {
  const outsideRoot = await mkdtemp(path.join(os.tmpdir(), 'node-vfs-outside-'));
  try {
    await withNodeVfs(async (vfs) => {
      await writeFile(path.join(outsideRoot, 'secret.txt'), 'secret');
      await symlink(path.join(outsideRoot, 'secret.txt'), path.join(vfs.rootDir, 'secret-link.txt'));

      const runtime = new AgentCLI({
        vfs,
        builtinCommands: {
          includeGroups: ['fs'],
          excludeCommands: ['append', 'cp', 'find', 'mkdir', 'mv', 'rm', 'write'],
        },
      });
      await runtime.initialize();

      const output = await runtime.run('cat /secret-link.txt');
      assert.doesNotMatch(output, /internal runtime error/i);
      assert.match(output, /cat: path escapes workspace root: \/secret-link\.txt/);
    });
  } finally {
    await rm(outsideRoot, { recursive: true, force: true });
  }
});
