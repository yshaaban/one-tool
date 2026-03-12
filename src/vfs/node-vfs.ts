import { existsSync, mkdirSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { VFS, VFileInfo } from './interface.js';
import { guessMediaType } from './interface.js';

function pathExists(target: string): boolean {
  return existsSync(target);
}

export class NodeVFS implements VFS {
  public readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
    mkdirSync(this.rootDir, { recursive: true });
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
      throw new Error(`path escapes root: ${inputPath}`);
    }
    return target;
  }

  async exists(inputPath: string): Promise<boolean> {
    return pathExists(this.resolve(inputPath));
  }

  async isDir(inputPath: string): Promise<boolean> {
    try {
      const stats = await fs.stat(this.resolve(inputPath));
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  async mkdir(inputPath: string, parents = true): Promise<string> {
    const target = this.resolve(inputPath);
    await fs.mkdir(target, { recursive: parents });
    return this.normalize(inputPath);
  }

  async listdir(inputPath = '/'): Promise<string[]> {
    const target = this.resolve(inputPath);
    if (!pathExists(target)) {
      throw new Error(`ENOENT:${this.normalize(inputPath)}`);
    }
    const stats = await fs.stat(target);
    if (!stats.isDirectory()) {
      throw new Error(`ENOTDIR:${this.normalize(inputPath)}`);
    }

    const entries = await fs.readdir(target, { withFileTypes: true });
    entries.sort((a, b) => {
      const aDir = a.isDirectory();
      const bDir = b.isDirectory();
      if (aDir !== bDir) {
        return aDir ? -1 : 1;
      }
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return entries.map((entry) => entry.name + (entry.isDirectory() ? '/' : ''));
  }

  async readBytes(inputPath: string): Promise<Uint8Array> {
    const target = this.resolve(inputPath);
    if (!pathExists(target)) {
      throw new Error(`ENOENT:${this.normalize(inputPath)}`);
    }
    const stats = await fs.stat(target);
    if (stats.isDirectory()) {
      throw new Error(`EISDIR:${this.normalize(inputPath)}`);
    }
    return new Uint8Array(await fs.readFile(target));
  }

  async readText(inputPath: string): Promise<string> {
    const raw = await this.readBytes(inputPath);
    return new TextDecoder('utf-8').decode(raw);
  }

  async writeBytes(inputPath: string, data: Uint8Array, makeParents = true): Promise<string> {
    const target = this.resolve(inputPath);
    if (makeParents) {
      await fs.mkdir(path.dirname(target), { recursive: true });
    }
    await fs.writeFile(target, data);
    return this.normalize(inputPath);
  }

  async appendBytes(inputPath: string, data: Uint8Array, makeParents = true): Promise<string> {
    const target = this.resolve(inputPath);
    if (makeParents) {
      await fs.mkdir(path.dirname(target), { recursive: true });
    }
    await fs.appendFile(target, data);
    return this.normalize(inputPath);
  }

  async delete(inputPath: string): Promise<string> {
    const target = this.resolve(inputPath);
    if (!pathExists(target)) {
      throw new Error(`ENOENT:${this.normalize(inputPath)}`);
    }
    await fs.rm(target, { recursive: true, force: false });
    return this.normalize(inputPath);
  }

  async copy(src: string, dst: string): Promise<{ src: string; dst: string }> {
    const srcPath = this.resolve(src);
    if (!pathExists(srcPath)) {
      throw new Error(`ENOENT:${this.normalize(src)}`);
    }
    const srcStats = await fs.stat(srcPath);
    const dstPath = this.resolve(dst);
    await fs.mkdir(path.dirname(dstPath), { recursive: true });

    if (srcStats.isDirectory()) {
      if (pathExists(dstPath)) {
        throw new Error(`EEXIST:${this.normalize(dst)}`);
      }
      await fs.cp(srcPath, dstPath, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    } else {
      await fs.copyFile(srcPath, dstPath);
    }

    return { src: this.normalize(src), dst: this.normalize(dst) };
  }

  async move(src: string, dst: string): Promise<{ src: string; dst: string }> {
    const srcPath = this.resolve(src);
    if (!pathExists(srcPath)) {
      throw new Error(`ENOENT:${this.normalize(src)}`);
    }
    const dstPath = this.resolve(dst);
    await fs.mkdir(path.dirname(dstPath), { recursive: true });

    try {
      await fs.rename(srcPath, dstPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('EXDEV')) {
        throw error;
      }
      const srcStats = await fs.stat(srcPath);
      if (srcStats.isDirectory()) {
        await fs.cp(srcPath, dstPath, { recursive: true, force: true });
        await fs.rm(srcPath, { recursive: true, force: false });
      } else {
        await fs.copyFile(srcPath, dstPath);
        await fs.unlink(srcPath);
      }
    }

    return { src: this.normalize(src), dst: this.normalize(dst) };
  }

  async stat(inputPath: string): Promise<VFileInfo> {
    const target = this.resolve(inputPath);
    if (!pathExists(target)) {
      return {
        path: this.normalize(inputPath),
        exists: false,
        isDir: false,
        size: 0,
        mediaType: '',
        modifiedEpochMs: 0,
      };
    }

    const stats = await fs.stat(target);
    return {
      path: this.normalize(inputPath),
      exists: true,
      isDir: stats.isDirectory(),
      size: Number(stats.size),
      mediaType: guessMediaType(path.basename(target), stats.isDirectory()),
      modifiedEpochMs: Math.floor(stats.mtimeMs),
    };
  }
}

/** @deprecated Use NodeVFS instead */
export { NodeVFS as RootedVFS };
