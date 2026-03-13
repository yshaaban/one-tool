import type { VFS, VFileInfo } from './interface.js';
import { guessMediaType } from './interface.js';
import { posixNormalize, parentOf, baseName, isStrictDescendantPath } from './path-utils.js';
import { vfsError } from './errors.js';
import {
  applyAppendToSnapshot,
  applyCopyToSnapshot,
  applyMkdirToSnapshot,
  applyMoveToSnapshot,
  applyWriteToSnapshot,
  cloneSnapshot,
  createSnapshotFromEntries,
  enforceResourcePolicy,
  hasResourcePolicy,
  type ResolvedVfsResourcePolicy,
  resolveVfsResourcePolicy,
  type VfsPolicyOptions,
  type VfsSnapshot,
} from './policy.js';

interface FileEntry {
  data: Uint8Array;
  mtimeMs: number;
}

export type MemoryVFSOptions = VfsPolicyOptions;

export class MemoryVFS implements VFS {
  private files = new Map<string, FileEntry>();
  private dirs = new Map<string, number>([['/', Date.now()]]);
  readonly resourcePolicy: ResolvedVfsResourcePolicy;

  constructor(options: MemoryVFSOptions = {}) {
    this.resourcePolicy = resolveVfsResourcePolicy(options.resourcePolicy);
  }

  private ensureDirectParent(normalizedPath: string): void {
    const parent = parentOf(normalizedPath);
    if (this.files.has(parent)) {
      throw vfsError('ENOTDIR', parent);
    }
    if (!this.dirs.has(parent)) {
      throw vfsError('ENOENT', parent);
    }
  }

  private ensureParents(normalizedPath: string): void {
    const segments = normalizedPath.split('/').filter(Boolean);
    let current = '';
    for (const seg of segments) {
      current += '/' + seg;
      if (this.files.has(current)) {
        throw vfsError('ENOTDIR', current);
      }
      if (!this.dirs.has(current)) {
        this.dirs.set(current, Date.now());
      }
    }
  }

  private validateParents(normalizedPath: string): void {
    const segments = normalizedPath.split('/').filter(Boolean);
    let current = '';
    for (const segment of segments) {
      current += `/${segment}`;
      if (this.files.has(current)) {
        throw vfsError('ENOTDIR', current);
      }
    }
  }

  private createSnapshot(): VfsSnapshot {
    return createSnapshotFromEntries(
      [...this.files.entries()].map(function ([path, entry]) {
        return [path, entry.data.length] as const;
      }),
      this.dirs.keys(),
    );
  }

  private enforcePolicy(contextPath: string, mutate: (snapshot: VfsSnapshot) => void): void {
    if (!hasResourcePolicy(this.resourcePolicy)) {
      return;
    }

    const snapshot = cloneSnapshot(this.createSnapshot());
    mutate(snapshot);
    enforceResourcePolicy(snapshot, this.resourcePolicy, contextPath);
  }

  normalize(inputPath: string): string {
    return posixNormalize(inputPath);
  }

  async exists(inputPath: string): Promise<boolean> {
    const p = this.normalize(inputPath);
    return this.dirs.has(p) || this.files.has(p);
  }

  async isDir(inputPath: string): Promise<boolean> {
    return this.dirs.has(this.normalize(inputPath));
  }

  async mkdir(inputPath: string, parents = true): Promise<string> {
    const p = this.normalize(inputPath);
    // Collision: a file already exists at this path
    if (this.files.has(p)) {
      throw vfsError('EEXIST', p);
    }
    if (parents) {
      this.validateParents(p);
    } else {
      this.ensureDirectParent(p);
    }
    this.enforcePolicy(p, function (snapshot): void {
      applyMkdirToSnapshot(snapshot, p, parents);
    });
    if (parents) {
      this.ensureParents(p);
      return p;
    }
    if (!this.dirs.has(p)) {
      this.dirs.set(p, Date.now());
    }
    return p;
  }

  async listdir(inputPath = '/'): Promise<string[]> {
    const p = this.normalize(inputPath);
    if (!this.dirs.has(p)) {
      if (this.files.has(p)) {
        throw vfsError('ENOTDIR', p);
      }
      throw vfsError('ENOENT', p);
    }

    const prefix = p === '/' ? '/' : p + '/';
    const entries: Array<{ name: string; isDir: boolean }> = [];

    for (const dirPath of this.dirs.keys()) {
      if (dirPath === p) continue;
      if (!dirPath.startsWith(prefix)) continue;
      // Only direct children (no nested)
      const rest = dirPath.slice(prefix.length);
      if (!rest.includes('/')) {
        entries.push({ name: rest, isDir: true });
      }
    }

    for (const filePath of this.files.keys()) {
      if (!filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      if (!rest.includes('/')) {
        entries.push({ name: rest, isDir: false });
      }
    }

    // Sort: dirs first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return entries.map((e) => e.name + (e.isDir ? '/' : ''));
  }

  async readBytes(inputPath: string): Promise<Uint8Array> {
    const p = this.normalize(inputPath);
    if (this.dirs.has(p)) {
      throw vfsError('EISDIR', p);
    }
    const entry = this.files.get(p);
    if (!entry) {
      throw vfsError('ENOENT', p);
    }
    return new Uint8Array(entry.data);
  }

  async readText(inputPath: string): Promise<string> {
    const raw = await this.readBytes(inputPath);
    return new TextDecoder('utf-8').decode(raw);
  }

  async writeBytes(inputPath: string, data: Uint8Array, makeParents = true): Promise<string> {
    const p = this.normalize(inputPath);
    if (this.dirs.has(p)) {
      throw vfsError('EISDIR', p);
    }
    if (makeParents) {
      this.validateParents(parentOf(p));
    } else {
      this.ensureDirectParent(p);
    }
    this.enforcePolicy(p, function (snapshot): void {
      applyWriteToSnapshot(snapshot, p, data.length, makeParents);
    });
    if (makeParents) {
      this.ensureParents(parentOf(p));
    } else {
      this.ensureDirectParent(p);
    }
    this.files.set(p, { data: new Uint8Array(data), mtimeMs: Date.now() });
    return p;
  }

  async appendBytes(inputPath: string, data: Uint8Array, makeParents = true): Promise<string> {
    const p = this.normalize(inputPath);
    if (this.dirs.has(p)) {
      throw vfsError('EISDIR', p);
    }
    if (makeParents) {
      this.validateParents(parentOf(p));
    } else {
      this.ensureDirectParent(p);
    }
    this.enforcePolicy(p, (snapshot): void => {
      applyAppendToSnapshot(snapshot, p, data.length, makeParents);
    });
    if (makeParents) {
      this.ensureParents(parentOf(p));
    } else {
      this.ensureDirectParent(p);
    }
    const existing = this.files.get(p);
    if (existing) {
      const merged = new Uint8Array(existing.data.length + data.length);
      merged.set(existing.data, 0);
      merged.set(data, existing.data.length);
      this.files.set(p, { data: merged, mtimeMs: Date.now() });
    } else {
      this.files.set(p, { data: new Uint8Array(data), mtimeMs: Date.now() });
    }
    return p;
  }

  async delete(inputPath: string): Promise<string> {
    const p = this.normalize(inputPath);
    if (this.files.has(p)) {
      this.files.delete(p);
      return p;
    }
    if (this.dirs.has(p)) {
      if (p === '/') throw vfsError('EROOT', p);
      // Delete dir and all children
      const prefix = p + '/';
      for (const key of [...this.files.keys()]) {
        if (key.startsWith(prefix)) this.files.delete(key);
      }
      for (const key of [...this.dirs.keys()]) {
        if (key === p || key.startsWith(prefix)) this.dirs.delete(key);
      }
      return p;
    }
    throw vfsError('ENOENT', p);
  }

  async copy(src: string, dst: string): Promise<{ src: string; dst: string }> {
    const srcP = this.normalize(src);
    const dstP = this.normalize(dst);

    if (this.files.has(srcP)) {
      const entry = this.files.get(srcP)!;
      this.validateParents(parentOf(dstP));
      this.enforcePolicy(dstP, function (snapshot): void {
        applyCopyToSnapshot(snapshot, srcP, dstP);
      });
      await this.writeBytes(dstP, entry.data);
      return { src: srcP, dst: dstP };
    }

    if (this.dirs.has(srcP)) {
      if (isStrictDescendantPath(srcP, dstP)) {
        throw vfsError('EINVAL', dstP, { targetPath: srcP });
      }
      if (this.dirs.has(dstP) || this.files.has(dstP)) {
        throw vfsError('EEXIST', dstP);
      }
      this.validateParents(parentOf(dstP));
      this.enforcePolicy(dstP, function (snapshot): void {
        applyCopyToSnapshot(snapshot, srcP, dstP);
      });
      const prefix = srcP === '/' ? '/' : srcP + '/';
      const sourceDirs = [...this.dirs.keys()].filter(
        (dirPath) => dirPath === srcP || dirPath.startsWith(prefix),
      );
      const sourceFiles = [...this.files.entries()].filter(([filePath]) => filePath.startsWith(prefix));

      this.ensureParents(parentOf(dstP));
      this.dirs.set(dstP, Date.now());

      for (const dirPath of sourceDirs) {
        if (dirPath === srcP) {
          continue;
        }
        if (dirPath.startsWith(prefix)) {
          this.dirs.set(dstP + dirPath.slice(srcP.length), Date.now());
        }
      }
      for (const [filePath, entry] of sourceFiles) {
        if (filePath.startsWith(prefix)) {
          this.files.set(dstP + filePath.slice(srcP.length), {
            data: new Uint8Array(entry.data),
            mtimeMs: Date.now(),
          });
        }
      }
      return { src: srcP, dst: dstP };
    }

    throw vfsError('ENOENT', srcP);
  }

  async move(src: string, dst: string): Promise<{ src: string; dst: string }> {
    const srcP = this.normalize(src);
    const dstP = this.normalize(dst);
    const dstParent = parentOf(dstP);
    if (srcP === dstP) {
      return { src: srcP, dst: dstP };
    }

    if (this.files.has(srcP)) {
      if (this.dirs.has(dstP)) {
        throw vfsError('EISDIR', dstP);
      }
      this.validateParents(dstParent);
      this.enforcePolicy(dstP, function (snapshot): void {
        applyMoveToSnapshot(snapshot, srcP, dstP);
      });
      const entry = this.files.get(srcP)!;
      this.ensureParents(dstParent);
      this.files.set(dstP, {
        data: new Uint8Array(entry.data),
        mtimeMs: Date.now(),
      });
      this.files.delete(srcP);
      return { src: srcP, dst: dstP };
    }

    if (this.dirs.has(srcP)) {
      if (isStrictDescendantPath(srcP, dstP)) {
        throw vfsError('EINVAL', dstP, { targetPath: srcP });
      }
      if (this.dirs.has(dstP) || this.files.has(dstP)) {
        throw vfsError('EEXIST', dstP);
      }
      this.validateParents(dstParent);
      this.enforcePolicy(dstP, function (snapshot): void {
        applyMoveToSnapshot(snapshot, srcP, dstP);
      });
      const prefix = srcP === '/' ? '/' : srcP + '/';
      const sourceDirs = [...this.dirs.keys()].filter(
        (dirPath) => dirPath === srcP || dirPath.startsWith(prefix),
      );
      const sourceFiles = [...this.files.entries()].filter(([filePath]) => filePath.startsWith(prefix));

      this.ensureParents(dstParent);
      this.dirs.set(dstP, Date.now());

      for (const dirPath of sourceDirs) {
        if (dirPath !== srcP) {
          this.dirs.set(dstP + dirPath.slice(srcP.length), Date.now());
        }
      }
      for (const [filePath, entry] of sourceFiles) {
        this.files.set(dstP + filePath.slice(srcP.length), {
          data: new Uint8Array(entry.data),
          mtimeMs: Date.now(),
        });
      }

      await this.delete(srcP);
      return { src: srcP, dst: dstP };
    }

    throw vfsError('ENOENT', srcP);
  }

  async stat(inputPath: string): Promise<VFileInfo> {
    const p = this.normalize(inputPath);

    if (this.dirs.has(p)) {
      return {
        path: p,
        exists: true,
        isDir: true,
        size: 0,
        mediaType: 'inode/directory',
        modifiedEpochMs: this.dirs.get(p) ?? 0,
      };
    }

    const entry = this.files.get(p);
    if (entry) {
      return {
        path: p,
        exists: true,
        isDir: false,
        size: entry.data.length,
        mediaType: guessMediaType(baseName(p), false),
        modifiedEpochMs: entry.mtimeMs,
      };
    }

    return {
      path: p,
      exists: false,
      isDir: false,
      size: 0,
      mediaType: '',
      modifiedEpochMs: 0,
    };
  }
}
