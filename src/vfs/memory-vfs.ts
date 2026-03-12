import type { VFS, VFileInfo } from './interface.js';
import { guessMediaType } from './interface.js';

interface FileEntry {
  data: Uint8Array;
  mtimeMs: number;
}

function posixNormalize(inputPath: string): string {
  const raw = inputPath.startsWith('/') ? inputPath : `/${inputPath}`;
  const segments: string[] = [];

  for (const seg of raw.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      segments.pop(); // clamp at root — never goes above /
    } else {
      segments.push(seg);
    }
  }

  return '/' + segments.join('/');
}

function parentOf(normalizedPath: string): string {
  const idx = normalizedPath.lastIndexOf('/');
  return idx <= 0 ? '/' : normalizedPath.slice(0, idx);
}

function baseName(normalizedPath: string): string {
  const idx = normalizedPath.lastIndexOf('/');
  return normalizedPath.slice(idx + 1);
}

export class MemoryVFS implements VFS {
  private files = new Map<string, FileEntry>();
  private dirs = new Set<string>(['/']);

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
    if (parents) {
      // Create all ancestors
      const segments = p.split('/').filter(Boolean);
      let current = '';
      for (const seg of segments) {
        current += '/' + seg;
        this.dirs.add(current);
      }
    } else {
      const parent = parentOf(p);
      if (!this.dirs.has(parent)) {
        throw new Error(`ENOENT:${parent}`);
      }
      this.dirs.add(p);
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

    for (const dirPath of this.dirs) {
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
    if (makeParents) {
      await this.mkdir(parentOf(p), true);
    }
    this.files.set(p, { data: new Uint8Array(data), mtimeMs: Date.now() });
    return p;
  }

  async appendBytes(inputPath: string, data: Uint8Array, makeParents = true): Promise<string> {
    const p = this.normalize(inputPath);
    if (makeParents) {
      await this.mkdir(parentOf(p), true);
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
      for (const key of [...this.dirs]) {
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
      if (this.dirs.has(dstP) || this.files.has(dstP)) {
        throw new Error(`EEXIST:${dstP}`);
      }
      // Copy directory tree
      this.dirs.add(dstP);
      const prefix = srcP === '/' ? '/' : srcP + '/';
      for (const dirPath of [...this.dirs]) {
        if (dirPath.startsWith(prefix)) {
          this.dirs.add(dstP + dirPath.slice(srcP.length));
        }
      }
      for (const [filePath, entry] of [...this.files.entries()]) {
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
    await this.copy(src, dst);
    await this.delete(src);
    return { src: this.normalize(src), dst: this.normalize(dst) };
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
        modifiedEpochMs: 0,
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
