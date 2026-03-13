import { lstatSync, mkdirSync, realpathSync, type Stats } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { VFS, VFileInfo } from './interface.js';
import { guessMediaType } from './interface.js';
import { vfsError } from './errors.js';
import {
  applyAppendToSnapshot,
  applyCopyToSnapshot,
  applyMkdirToSnapshot,
  applyMoveToSnapshot,
  applyWriteToSnapshot,
  cloneSnapshot,
  createEmptySnapshot,
  enforceResourcePolicy,
  hasResourcePolicy,
  type ResolvedVfsResourcePolicy,
  resolveVfsResourcePolicy,
  type VfsPolicyOptions,
  type VfsSnapshot,
} from './policy.js';
import { isStrictDescendantPath, parentOf } from './path-utils.js';

export type NodeVFSOptions = VfsPolicyOptions;

export class NodeVFS implements VFS {
  public readonly rootDir: string;
  public readonly resourcePolicy: ResolvedVfsResourcePolicy;

  constructor(rootDir: string, options: NodeVFSOptions = {}) {
    const resolvedRoot = path.resolve(rootDir);
    mkdirSync(resolvedRoot, { recursive: true });
    this.rootDir = realpathSync(resolvedRoot);
    this.resourcePolicy = resolveVfsResourcePolicy(options.resourcePolicy);
  }

  normalize(inputPath: string): string {
    if (!inputPath) {
      return '/';
    }
    const candidate = inputPath.startsWith('/') ? inputPath : `/${inputPath}`;
    const normalized = path.posix.normalize(candidate);
    return normalized.startsWith('/') ? normalized : `/${normalized}`;
  }

  resolve(inputPath: string): string {
    const normalized = this.normalize(inputPath);
    const relative = normalized.slice(1);
    const target = path.resolve(this.rootDir, relative);
    const backToRoot = path.relative(this.rootDir, target);
    if (backToRoot !== '' && (backToRoot.startsWith('..') || path.isAbsolute(backToRoot))) {
      throw vfsError('EESCAPE', normalized);
    }
    return target;
  }

  async exists(inputPath: string): Promise<boolean> {
    return (await this.statPath(this.normalize(inputPath))) !== null;
  }

  async isDir(inputPath: string): Promise<boolean> {
    const stats = await this.statPath(this.normalize(inputPath));
    return stats?.isDirectory() ?? false;
  }

  async mkdir(inputPath: string, parents = true): Promise<string> {
    const normalized = this.normalize(inputPath);
    if (normalized === '/') {
      return normalized;
    }

    const existing = await this.statPath(normalized);
    if (existing && !existing.isDirectory()) {
      throw vfsError('EEXIST', normalized);
    }

    if (parents) {
      await this.validateParents(normalized);
    } else {
      await this.ensureDirectoryExists(parentOf(normalized));
    }

    await this.enforcePolicy(normalized, function (snapshot): void {
      applyMkdirToSnapshot(snapshot, normalized, parents);
    });

    await fs.mkdir(this.resolve(normalized), { recursive: parents });
    return normalized;
  }

  async listdir(inputPath = '/'): Promise<string[]> {
    const normalized = this.normalize(inputPath);
    const stats = await this.statPath(normalized);
    if (!stats) {
      throw vfsError('ENOENT', normalized);
    }
    if (!stats.isDirectory()) {
      throw vfsError('ENOTDIR', normalized);
    }

    const entries = (await fs.readdir(this.resolve(normalized), { withFileTypes: true })).filter(
      function (entry) {
        return !entry.isSymbolicLink();
      },
    );

    entries.sort(function (a, b) {
      const aDir = a.isDirectory();
      const bDir = b.isDirectory();
      if (aDir !== bDir) {
        return aDir ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return entries.map(function (entry) {
      return entry.name + (entry.isDirectory() ? '/' : '');
    });
  }

  async readBytes(inputPath: string): Promise<Uint8Array> {
    const normalized = this.normalize(inputPath);
    const stats = await this.statPath(normalized);
    if (!stats) {
      throw vfsError('ENOENT', normalized);
    }
    if (stats.isDirectory()) {
      throw vfsError('EISDIR', normalized);
    }
    return new Uint8Array(await fs.readFile(this.resolve(normalized)));
  }

  async readText(inputPath: string): Promise<string> {
    const raw = await this.readBytes(inputPath);
    return new TextDecoder('utf-8').decode(raw);
  }

  async writeBytes(inputPath: string, data: Uint8Array, makeParents = true): Promise<string> {
    const normalized = this.normalize(inputPath);
    await this.ensureWritablePath(normalized, makeParents);
    await this.enforcePolicy(normalized, function (snapshot): void {
      applyWriteToSnapshot(snapshot, normalized, data.length, makeParents);
    });
    await this.ensureParentPath(normalized, makeParents);
    await fs.writeFile(this.resolve(normalized), data);
    return normalized;
  }

  async appendBytes(inputPath: string, data: Uint8Array, makeParents = true): Promise<string> {
    const normalized = this.normalize(inputPath);
    await this.ensureWritablePath(normalized, makeParents);
    await this.enforcePolicy(normalized, function (snapshot): void {
      applyAppendToSnapshot(snapshot, normalized, data.length, makeParents);
    });
    await this.ensureParentPath(normalized, makeParents);
    await fs.appendFile(this.resolve(normalized), data);
    return normalized;
  }

  async delete(inputPath: string): Promise<string> {
    const normalized = this.normalize(inputPath);
    if (normalized === '/') {
      throw vfsError('EROOT', normalized);
    }
    if (!(await this.exists(normalized))) {
      throw vfsError('ENOENT', normalized);
    }
    await fs.rm(this.resolve(normalized), { recursive: true, force: false });
    return normalized;
  }

  async copy(src: string, dst: string): Promise<{ src: string; dst: string }> {
    const srcPath = this.normalize(src);
    const dstPath = this.normalize(dst);
    const srcStats = await this.statPath(srcPath);

    if (!srcStats) {
      throw vfsError('ENOENT', srcPath);
    }
    if (srcStats.isDirectory() && isStrictDescendantPath(srcPath, dstPath)) {
      throw vfsError('EINVAL', dstPath, { targetPath: srcPath });
    }

    const dstStats = await this.statPath(dstPath);
    if (srcStats.isDirectory()) {
      if (dstStats) {
        throw vfsError('EEXIST', dstPath);
      }
    } else if (dstStats?.isDirectory()) {
      throw vfsError('EISDIR', dstPath);
    }

    await this.ensureParentPath(dstPath, true);
    await this.enforcePolicy(dstPath, function (snapshot): void {
      applyCopyToSnapshot(snapshot, srcPath, dstPath);
    });

    const resolvedSrc = this.resolve(srcPath);
    const resolvedDst = this.resolve(dstPath);
    await fs.mkdir(path.dirname(resolvedDst), { recursive: true });

    if (srcStats.isDirectory()) {
      await fs.cp(resolvedSrc, resolvedDst, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    } else {
      await fs.copyFile(resolvedSrc, resolvedDst);
    }

    return { src: srcPath, dst: dstPath };
  }

  async move(src: string, dst: string): Promise<{ src: string; dst: string }> {
    const srcPath = this.normalize(src);
    const dstPath = this.normalize(dst);
    if (srcPath === dstPath) {
      return { src: srcPath, dst: dstPath };
    }

    const srcStats = await this.statPath(srcPath);
    if (!srcStats) {
      throw vfsError('ENOENT', srcPath);
    }
    if (srcStats.isDirectory() && isStrictDescendantPath(srcPath, dstPath)) {
      throw vfsError('EINVAL', dstPath, { targetPath: srcPath });
    }

    const dstStats = await this.statPath(dstPath);
    if (srcStats.isDirectory()) {
      if (dstStats) {
        throw vfsError('EEXIST', dstPath);
      }
    } else if (dstStats?.isDirectory()) {
      throw vfsError('EISDIR', dstPath);
    }

    await this.ensureParentPath(dstPath, true);
    await this.enforcePolicy(dstPath, function (snapshot): void {
      applyMoveToSnapshot(snapshot, srcPath, dstPath);
    });

    const resolvedSrc = this.resolve(srcPath);
    const resolvedDst = this.resolve(dstPath);
    await fs.mkdir(path.dirname(resolvedDst), { recursive: true });

    try {
      await fs.rename(resolvedSrc, resolvedDst);
    } catch (caught) {
      if (!this.isCrossDeviceRenameError(caught)) {
        throw caught;
      }

      if (srcStats.isDirectory()) {
        await fs.cp(resolvedSrc, resolvedDst, { recursive: true, force: true });
        await fs.rm(resolvedSrc, { recursive: true, force: false });
      } else {
        await fs.copyFile(resolvedSrc, resolvedDst);
        await fs.unlink(resolvedSrc);
      }
    }

    return { src: srcPath, dst: dstPath };
  }

  async stat(inputPath: string): Promise<VFileInfo> {
    const normalized = this.normalize(inputPath);
    const stats = await this.statPath(normalized);
    if (!stats) {
      return {
        path: normalized,
        exists: false,
        isDir: false,
        size: 0,
        mediaType: '',
        modifiedEpochMs: 0,
      };
    }

    return {
      path: normalized,
      exists: true,
      isDir: stats.isDirectory(),
      size: stats.isDirectory() ? 0 : Number(stats.size),
      mediaType: guessMediaType(path.basename(this.resolve(normalized)), stats.isDirectory()),
      modifiedEpochMs: Math.floor(stats.mtimeMs),
    };
  }

  private async statPath(normalizedPath: string): Promise<Stats | null> {
    this.assertNoSymlinkTraversal(normalizedPath);
    const target = this.resolve(normalizedPath);
    try {
      return await fs.stat(target);
    } catch (caught) {
      if (this.isNotFoundError(caught)) {
        return null;
      }
      throw caught;
    }
  }

  private assertNoSymlinkTraversal(normalizedPath: string): void {
    if (normalizedPath === '/') {
      return;
    }

    let currentHostPath = this.rootDir;
    let currentVirtualPath = '';

    for (const segment of normalizedPath.split('/').filter(Boolean)) {
      currentVirtualPath += `/${segment}`;
      currentHostPath = path.join(currentHostPath, segment);

      let stats: Stats;
      try {
        stats = lstatSync(currentHostPath);
      } catch (caught) {
        if (this.isNotFoundError(caught)) {
          return;
        }
        throw caught;
      }

      if (stats.isSymbolicLink()) {
        throw vfsError('EESCAPE', currentVirtualPath);
      }
    }
  }

  private async ensureDirectoryExists(normalizedPath: string): Promise<void> {
    const stats = await this.statPath(normalizedPath);
    if (!stats) {
      throw vfsError('ENOENT', normalizedPath);
    }
    if (!stats.isDirectory()) {
      throw vfsError('ENOTDIR', normalizedPath);
    }
  }

  private async validateParents(normalizedPath: string): Promise<void> {
    if (normalizedPath === '/') {
      return;
    }

    let current = '';
    for (const segment of normalizedPath.split('/').filter(Boolean)) {
      current += `/${segment}`;
      const stats = await this.statPath(current);
      if (stats && !stats.isDirectory()) {
        throw vfsError('ENOTDIR', current);
      }
    }
  }

  private async ensureParentPath(normalizedPath: string, makeParents: boolean): Promise<void> {
    const parentPath = parentOf(normalizedPath);
    if (makeParents) {
      await this.validateParents(parentPath);
      await fs.mkdir(this.resolve(parentPath), { recursive: true });
      return;
    }

    await this.ensureDirectoryExists(parentPath);
  }

  private async ensureWritablePath(normalizedPath: string, makeParents: boolean): Promise<void> {
    const targetStats = await this.statPath(normalizedPath);
    if (targetStats?.isDirectory()) {
      throw vfsError('EISDIR', normalizedPath);
    }

    if (makeParents) {
      await this.validateParents(parentOf(normalizedPath));
      return;
    }

    await this.ensureDirectoryExists(parentOf(normalizedPath));
  }

  private async createSnapshot(): Promise<VfsSnapshot> {
    const snapshot = createEmptySnapshot();
    await this.walkSnapshot('/', this.rootDir, snapshot);
    return snapshot;
  }

  private async walkSnapshot(
    normalizedDir: string,
    resolvedDir: string,
    snapshot: VfsSnapshot,
  ): Promise<void> {
    const entries = await fs.readdir(resolvedDir, { withFileTypes: true });

    for (const entry of entries) {
      const childNormalized = normalizedDir === '/' ? `/${entry.name}` : `${normalizedDir}/${entry.name}`;
      const childResolved = path.join(resolvedDir, entry.name);

      if (entry.isDirectory()) {
        snapshot.dirs.add(childNormalized);
        await this.walkSnapshot(childNormalized, childResolved, snapshot);
        continue;
      }

      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isFile()) {
        const stats = await fs.stat(childResolved);
        snapshot.files.set(childNormalized, Number(stats.size));
      }
    }
  }

  private async enforcePolicy(contextPath: string, mutate: (snapshot: VfsSnapshot) => void): Promise<void> {
    if (!hasResourcePolicy(this.resourcePolicy)) {
      return;
    }

    const snapshot = cloneSnapshot(await this.createSnapshot());
    mutate(snapshot);
    enforceResourcePolicy(snapshot, this.resourcePolicy, contextPath);
  }

  private isCrossDeviceRenameError(caught: unknown): boolean {
    return (
      !!caught &&
      typeof caught === 'object' &&
      'code' in caught &&
      (caught as { code?: unknown }).code === 'EXDEV'
    );
  }

  private isNotFoundError(caught: unknown): boolean {
    return (
      !!caught &&
      typeof caught === 'object' &&
      'code' in caught &&
      (caught as { code?: unknown }).code === 'ENOENT'
    );
  }
}

/** @deprecated Use NodeVFS instead */
export { NodeVFS as RootedVFS };
