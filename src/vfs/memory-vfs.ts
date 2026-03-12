import type { VFS, VFileInfo } from './interface.js';
import { guessMediaType } from './interface.js';
import { posixNormalize, parentOf, baseName, isStrictDescendantPath } from './path-utils.js';

interface FileEntry {
  data: Uint8Array;
  mtimeMs: number;
}

export class MemoryVFS implements VFS {
  private files = new Map<string, FileEntry>();
  private dirs = new Map<string, number>([['/', Date.now()]]);

  private ensureDirectParent(normalizedPath: string): void {
    const parent = parentOf(normalizedPath);
    if (this.files.has(parent)) {
      throw new Error(`ENOTDIR:${parent}`);
    }
    if (!this.dirs.has(parent)) {
      throw new Error(`ENOENT:${parent}`);
    }
  }

  private ensureParents(normalizedPath: string): void {
    const segments = normalizedPath.split('/').filter(Boolean);
    let current = '';
    for (const seg of segments) {
      current += '/' + seg;
      if (this.files.has(current)) {
        throw new Error(`ENOTDIR:${current}`);
      }
      if (!this.dirs.has(current)) {
        this.dirs.set(current, Date.now());
      }
    }
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
      throw new Error(`EEXIST:${p}`);
    }
    if (parents) {
      this.ensureParents(p);
    } else {
      this.ensureDirectParent(p);
      if (!this.dirs.has(p)) {
        this.dirs.set(p, Date.now());
      }
    }
    return p;
  }

  async listdir(inputPath = '/'): Promise<string[]> {
    const p = this.normalize(inputPath);
    if (!this.dirs.has(p)) {
      if (this.files.has(p)) {
        throw new Error(`ENOTDIR:${p}`);
      }
      throw new Error(`ENOENT:${p}`);
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
      throw new Error(`EISDIR:${p}`);
    }
    const entry = this.files.get(p);
    if (!entry) {
      throw new Error(`ENOENT:${p}`);
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
      throw new Error(`EISDIR:${p}`);
    }
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
      throw new Error(`EISDIR:${p}`);
    }
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
      if (p === '/') throw new Error('cannot delete root');
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
    throw new Error(`ENOENT:${p}`);
  }

  async copy(src: string, dst: string): Promise<{ src: string; dst: string }> {
    const srcP = this.normalize(src);
    const dstP = this.normalize(dst);

    if (this.files.has(srcP)) {
      const entry = this.files.get(srcP)!;
      await this.writeBytes(dstP, entry.data);
      return { src: srcP, dst: dstP };
    }

    if (this.dirs.has(srcP)) {
      if (isStrictDescendantPath(srcP, dstP)) {
        throw new Error(`EINVAL:${dstP}`);
      }
      if (this.dirs.has(dstP) || this.files.has(dstP)) {
        throw new Error(`EEXIST:${dstP}`);
      }
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

    throw new Error(`ENOENT:${srcP}`);
  }

  async move(src: string, dst: string): Promise<{ src: string; dst: string }> {
    const srcP = this.normalize(src);
    const dstP = this.normalize(dst);
    if (srcP === dstP) {
      return { src: srcP, dst: dstP };
    }
    if (this.dirs.has(srcP) && isStrictDescendantPath(srcP, dstP)) {
      throw new Error(`EINVAL:${dstP}`);
    }
    await this.copy(srcP, dstP);
    await this.delete(srcP);
    return { src: srcP, dst: dstP };
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
