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

const STORE_FILES = 'files';
const STORE_DIRS = 'dirs';

/**
 * Bump this when the object store schema changes.
 * The `onupgradeneeded` handler in `openDatabase()` must migrate data
 * from the previous version to the new one — never drop stores blindly.
 */
const DB_VERSION = 1;

interface FileRecord {
  path: string;
  data: Uint8Array;
  mtimeMs: number;
}

interface DirRecord {
  path: string;
  mtimeMs: number;
}

export type BrowserVFSOpenOptions = VfsPolicyOptions;

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisifyTransaction(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

function openDatabase(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_FILES)) {
        db.createObjectStore(STORE_FILES, { keyPath: 'path' });
      }
      if (!db.objectStoreNames.contains(STORE_DIRS)) {
        db.createObjectStore(STORE_DIRS, { keyPath: 'path' });
      }
    };

    // Fired when another connection (e.g. a second tab) triggers a
    // version upgrade while this connection is still open.  Close
    // gracefully so the upgrade can proceed.
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * IndexedDB-backed VFS for browser environments.
 *
 * Data persists across page reloads. Each database name is an isolated
 * filesystem. Use the async factory to create instances:
 *
 * ```ts
 * const vfs = await BrowserVFS.open('my-agent-db');
 * ```
 */
export class BrowserVFS implements VFS {
  private db: IDBDatabase;
  readonly dbName: string;
  readonly resourcePolicy: ResolvedVfsResourcePolicy;

  private constructor(db: IDBDatabase, dbName: string, options: BrowserVFSOpenOptions) {
    this.db = db;
    this.dbName = dbName;
    this.resourcePolicy = resolveVfsResourcePolicy(options.resourcePolicy);
  }

  /** Open (or create) a named IndexedDB database and return a ready VFS. */
  static async open(dbName = 'one-tool-vfs', options: BrowserVFSOpenOptions = {}): Promise<BrowserVFS> {
    const db = await openDatabase(dbName);
    const vfs = new BrowserVFS(db, dbName, options);

    // Ensure root dir exists
    const tx = db.transaction(STORE_DIRS, 'readwrite');
    const store = tx.objectStore(STORE_DIRS);
    const existing = await promisifyRequest(store.get('/'));
    if (!existing) {
      store.put({ path: '/', mtimeMs: Date.now() } satisfies DirRecord);
    }
    await promisifyTransaction(tx);

    return vfs;
  }

  /** Close the underlying IndexedDB connection. */
  close(): void {
    this.db.close();
  }

  /**
   * Delete the entire database.
   *
   * **Important:** call `close()` on every open instance of this database
   * *before* calling `destroy()`, otherwise the delete may be blocked by
   * the browser until the connection is released.
   */
  static async destroy(dbName: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(dbName);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // ── helpers ──────────────────────────────────────────────────────

  normalize(inputPath: string): string {
    return posixNormalize(inputPath);
  }

  private tx(stores: string | string[], mode: IDBTransactionMode): IDBTransaction {
    return this.db.transaction(stores, mode);
  }

  private async hasDir(path: string, dirStore?: IDBObjectStore): Promise<boolean> {
    const store = dirStore ?? this.tx(STORE_DIRS, 'readonly').objectStore(STORE_DIRS);
    const record = await promisifyRequest(store.get(path));
    return record !== undefined;
  }

  private async hasFile(path: string, fileStore?: IDBObjectStore): Promise<boolean> {
    const store = fileStore ?? this.tx(STORE_FILES, 'readonly').objectStore(STORE_FILES);
    const record = await promisifyRequest(store.get(path));
    return record !== undefined;
  }

  private async ensureParents(
    normalizedPath: string,
    dirStore: IDBObjectStore,
    fileStore?: IDBObjectStore,
  ): Promise<void> {
    const segments = normalizedPath.split('/').filter(Boolean);
    let current = '';
    for (const seg of segments) {
      current += '/' + seg;
      // If a file already occupies an ancestor path, the mkdir is invalid
      if (fileStore) {
        const fileCollision = await promisifyRequest(fileStore.get(current));
        if (fileCollision) {
          throw vfsError('ENOTDIR', current);
        }
      }
      const existing = await promisifyRequest(dirStore.get(current));
      if (!existing) {
        dirStore.put({ path: current, mtimeMs: Date.now() } satisfies DirRecord);
      }
    }
  }

  private async validateParents(normalizedPath: string, fileStore: IDBObjectStore): Promise<void> {
    const segments = normalizedPath.split('/').filter(Boolean);
    let current = '';
    for (const segment of segments) {
      current += `/${segment}`;
      if (await promisifyRequest(fileStore.get(current))) {
        throw vfsError('ENOTDIR', current);
      }
    }
  }

  private async createSnapshot(dirStore: IDBObjectStore, fileStore: IDBObjectStore): Promise<VfsSnapshot> {
    const allDirs = (await promisifyRequest(dirStore.getAll())) as DirRecord[];
    const allFiles = (await promisifyRequest(fileStore.getAll())) as FileRecord[];
    return createSnapshotFromEntries(
      allFiles.map(function (file) {
        return [file.path, file.data.length] as const;
      }),
      allDirs.map(function (dir) {
        return dir.path;
      }),
    );
  }

  private async enforcePolicy(
    contextPath: string,
    dirStore: IDBObjectStore,
    fileStore: IDBObjectStore,
    mutate: (snapshot: VfsSnapshot) => void,
  ): Promise<void> {
    if (!hasResourcePolicy(this.resourcePolicy)) {
      return;
    }

    const snapshot = cloneSnapshot(await this.createSnapshot(dirStore, fileStore));
    mutate(snapshot);
    enforceResourcePolicy(snapshot, this.resourcePolicy, contextPath);
  }

  // ── VFS interface ────────────────────────────────────────────────

  async exists(inputPath: string): Promise<boolean> {
    const p = this.normalize(inputPath);
    const tx = this.tx([STORE_DIRS, STORE_FILES], 'readonly');
    const inDirs = await promisifyRequest(tx.objectStore(STORE_DIRS).get(p));
    if (inDirs) return true;
    const inFiles = await promisifyRequest(tx.objectStore(STORE_FILES).get(p));
    return inFiles !== undefined;
  }

  async isDir(inputPath: string): Promise<boolean> {
    return this.hasDir(this.normalize(inputPath));
  }

  async mkdir(inputPath: string, parents = true): Promise<string> {
    const p = this.normalize(inputPath);
    if (p === '/') {
      return p;
    }
    const tx = this.tx([STORE_DIRS, STORE_FILES], 'readwrite');
    const dirStore = tx.objectStore(STORE_DIRS);
    const fileStore = tx.objectStore(STORE_FILES);

    // Collision: a file already exists at this exact path
    const fileCollision = await promisifyRequest(fileStore.get(p));
    if (fileCollision) {
      throw vfsError('EEXIST', p);
    }
    if (parents) {
      await this.validateParents(p, fileStore);
    } else {
      const parent = parentOf(p);
      if (await promisifyRequest(fileStore.get(parent))) {
        throw vfsError('ENOTDIR', parent);
      }
      const parentExists = await promisifyRequest(dirStore.get(parent));
      if (!parentExists) {
        throw vfsError('ENOENT', parent);
      }
    }

    await this.enforcePolicy(p, dirStore, fileStore, function (snapshot): void {
      applyMkdirToSnapshot(snapshot, p, parents);
    });

    if (parents) {
      await this.ensureParents(p, dirStore, fileStore);
    } else {
      dirStore.put({ path: p, mtimeMs: Date.now() } satisfies DirRecord);
    }

    await promisifyTransaction(tx);
    return p;
  }

  async listdir(inputPath = '/'): Promise<string[]> {
    const p = this.normalize(inputPath);
    const tx = this.tx([STORE_DIRS, STORE_FILES], 'readonly');
    const dirStore = tx.objectStore(STORE_DIRS);
    const fileStore = tx.objectStore(STORE_FILES);

    const dirExists = await promisifyRequest(dirStore.get(p));
    if (!dirExists) {
      const fileExists = await promisifyRequest(fileStore.get(p));
      if (fileExists) {
        throw vfsError('ENOTDIR', p);
      }
      throw vfsError('ENOENT', p);
    }

    const prefix = p === '/' ? '/' : p + '/';
    const entries: Array<{ name: string; isDir: boolean }> = [];

    // NOTE: getAll() + linear scan is O(n) over the entire store.
    // Fine for typical agent workloads (hundreds of files). For very
    // large filesystems, add an IDB index on a "parent" field instead.

    // Scan all dirs
    const allDirs = (await promisifyRequest(dirStore.getAll())) as DirRecord[];
    for (const dir of allDirs) {
      if (dir.path === p) continue;
      if (!dir.path.startsWith(prefix)) continue;
      const rest = dir.path.slice(prefix.length);
      if (!rest.includes('/')) {
        entries.push({ name: rest, isDir: true });
      }
    }

    // Scan all files
    const allFiles = (await promisifyRequest(fileStore.getAll())) as FileRecord[];
    for (const file of allFiles) {
      if (!file.path.startsWith(prefix)) continue;
      const rest = file.path.slice(prefix.length);
      if (!rest.includes('/')) {
        entries.push({ name: rest, isDir: false });
      }
    }

    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return entries.map((e) => e.name + (e.isDir ? '/' : ''));
  }

  async readBytes(inputPath: string): Promise<Uint8Array> {
    const p = this.normalize(inputPath);
    const tx = this.tx([STORE_DIRS, STORE_FILES], 'readonly');

    const dirExists = await promisifyRequest(tx.objectStore(STORE_DIRS).get(p));
    if (dirExists) {
      throw vfsError('EISDIR', p);
    }

    const record = (await promisifyRequest(tx.objectStore(STORE_FILES).get(p))) as FileRecord | undefined;
    if (!record) {
      throw vfsError('ENOENT', p);
    }

    return new Uint8Array(record.data);
  }

  async readText(inputPath: string): Promise<string> {
    const raw = await this.readBytes(inputPath);
    return new TextDecoder('utf-8').decode(raw);
  }

  async writeBytes(inputPath: string, data: Uint8Array, makeParents = true): Promise<string> {
    const p = this.normalize(inputPath);
    const tx = this.tx([STORE_DIRS, STORE_FILES], 'readwrite');
    const dirStore = tx.objectStore(STORE_DIRS);
    const fileStore = tx.objectStore(STORE_FILES);

    // Collision: cannot overwrite a directory with a file
    const dirCollision = await promisifyRequest(dirStore.get(p));
    if (dirCollision) {
      throw vfsError('EISDIR', p);
    }
    if (makeParents) {
      await this.validateParents(parentOf(p), fileStore);
    } else {
      const parent = parentOf(p);
      if (await promisifyRequest(fileStore.get(parent))) {
        throw vfsError('ENOTDIR', parent);
      }
      if (!(await promisifyRequest(dirStore.get(parent)))) {
        throw vfsError('ENOENT', parent);
      }
    }

    await this.enforcePolicy(p, dirStore, fileStore, function (snapshot): void {
      applyWriteToSnapshot(snapshot, p, data.length, makeParents);
    });

    if (makeParents) {
      await this.ensureParents(parentOf(p), dirStore, fileStore);
    }

    fileStore.put({
      path: p,
      data: new Uint8Array(data),
      mtimeMs: Date.now(),
    } satisfies FileRecord);

    await promisifyTransaction(tx);
    return p;
  }

  async appendBytes(inputPath: string, data: Uint8Array, makeParents = true): Promise<string> {
    const p = this.normalize(inputPath);
    const tx = this.tx([STORE_DIRS, STORE_FILES], 'readwrite');
    const dirStore = tx.objectStore(STORE_DIRS);

    // Collision: cannot append to a directory
    const dirCollision = await promisifyRequest(dirStore.get(p));
    if (dirCollision) {
      throw vfsError('EISDIR', p);
    }

    const fileStore = tx.objectStore(STORE_FILES);
    if (makeParents) {
      await this.validateParents(parentOf(p), fileStore);
    } else {
      const parent = parentOf(p);
      if (await promisifyRequest(fileStore.get(parent))) {
        throw vfsError('ENOTDIR', parent);
      }
      if (!(await promisifyRequest(dirStore.get(parent)))) {
        throw vfsError('ENOENT', parent);
      }
    }
    await this.enforcePolicy(p, dirStore, fileStore, function (snapshot): void {
      applyAppendToSnapshot(snapshot, p, data.length, makeParents);
    });

    if (makeParents) {
      await this.ensureParents(parentOf(p), dirStore, fileStore);
    }

    const existing = (await promisifyRequest(fileStore.get(p))) as FileRecord | undefined;

    if (existing) {
      const merged = new Uint8Array(existing.data.length + data.length);
      merged.set(new Uint8Array(existing.data), 0);
      merged.set(data, existing.data.length);
      fileStore.put({ path: p, data: merged, mtimeMs: Date.now() } satisfies FileRecord);
    } else {
      fileStore.put({ path: p, data: new Uint8Array(data), mtimeMs: Date.now() } satisfies FileRecord);
    }

    await promisifyTransaction(tx);
    return p;
  }

  async delete(inputPath: string): Promise<string> {
    const p = this.normalize(inputPath);
    const tx = this.tx([STORE_DIRS, STORE_FILES], 'readwrite');
    const fileStore = tx.objectStore(STORE_FILES);
    const dirStore = tx.objectStore(STORE_DIRS);

    // Check if it's a file
    const fileRecord = await promisifyRequest(fileStore.get(p));
    if (fileRecord) {
      fileStore.delete(p);
      await promisifyTransaction(tx);
      return p;
    }

    // Check if it's a directory
    const dirRecord = await promisifyRequest(dirStore.get(p));
    if (!dirRecord) {
      throw vfsError('ENOENT', p);
    }
    if (p === '/') {
      throw vfsError('EROOT', p);
    }

    // Delete the dir and all children
    const prefix = p + '/';

    const allDirs = (await promisifyRequest(dirStore.getAll())) as DirRecord[];
    for (const dir of allDirs) {
      if (dir.path === p || dir.path.startsWith(prefix)) {
        dirStore.delete(dir.path);
      }
    }

    const allFiles = (await promisifyRequest(fileStore.getAll())) as FileRecord[];
    for (const file of allFiles) {
      if (file.path.startsWith(prefix)) {
        fileStore.delete(file.path);
      }
    }

    await promisifyTransaction(tx);
    return p;
  }

  async copy(src: string, dst: string): Promise<{ src: string; dst: string }> {
    const srcP = this.normalize(src);
    const dstP = this.normalize(dst);
    const tx = this.tx([STORE_DIRS, STORE_FILES], 'readwrite');
    const fileStore = tx.objectStore(STORE_FILES);
    const dirStore = tx.objectStore(STORE_DIRS);

    // File copy
    const fileRecord = (await promisifyRequest(fileStore.get(srcP))) as FileRecord | undefined;
    if (fileRecord) {
      const dstDirCollision = await promisifyRequest(dirStore.get(dstP));
      if (dstDirCollision) {
        throw vfsError('EISDIR', dstP);
      }
      await this.validateParents(parentOf(dstP), fileStore);
      await this.enforcePolicy(dstP, dirStore, fileStore, function (snapshot): void {
        applyCopyToSnapshot(snapshot, srcP, dstP);
      });
      await this.ensureParents(parentOf(dstP), dirStore, fileStore);
      fileStore.put({
        path: dstP,
        data: new Uint8Array(fileRecord.data),
        mtimeMs: Date.now(),
      } satisfies FileRecord);
      await promisifyTransaction(tx);
      return { src: srcP, dst: dstP };
    }

    // Directory copy
    const dirRecord = await promisifyRequest(dirStore.get(srcP));
    if (!dirRecord) {
      throw vfsError('ENOENT', srcP);
    }

    // Check destination doesn't exist
    const dstDirExists = await promisifyRequest(dirStore.get(dstP));
    const dstFileExists = await promisifyRequest(fileStore.get(dstP));
    if (dstDirExists || dstFileExists) {
      throw vfsError('EEXIST', dstP);
    }
    if (isStrictDescendantPath(srcP, dstP)) {
      throw vfsError('EINVAL', dstP, { targetPath: srcP });
    }
    await this.validateParents(parentOf(dstP), fileStore);
    await this.enforcePolicy(dstP, dirStore, fileStore, function (snapshot): void {
      applyCopyToSnapshot(snapshot, srcP, dstP);
    });

    // Copy directory tree
    await this.ensureParents(parentOf(dstP), dirStore, fileStore);
    dirStore.put({ path: dstP, mtimeMs: Date.now() } satisfies DirRecord);
    const prefix = srcP === '/' ? '/' : srcP + '/';

    const allDirs = (await promisifyRequest(dirStore.getAll())) as DirRecord[];
    for (const dir of allDirs) {
      if (dir.path.startsWith(prefix)) {
        dirStore.put({
          path: dstP + dir.path.slice(srcP.length),
          mtimeMs: Date.now(),
        } satisfies DirRecord);
      }
    }

    const allFiles = (await promisifyRequest(fileStore.getAll())) as FileRecord[];
    for (const file of allFiles) {
      if (file.path.startsWith(prefix)) {
        fileStore.put({
          path: dstP + file.path.slice(srcP.length),
          data: new Uint8Array(file.data),
          mtimeMs: Date.now(),
        } satisfies FileRecord);
      }
    }

    await promisifyTransaction(tx);
    return { src: srcP, dst: dstP };
  }

  async move(src: string, dst: string): Promise<{ src: string; dst: string }> {
    const srcP = this.normalize(src);
    const dstP = this.normalize(dst);
    const dstParent = parentOf(dstP);
    if (srcP === dstP) {
      return { src: srcP, dst: dstP };
    }
    const tx = this.tx([STORE_DIRS, STORE_FILES], 'readwrite');
    const dirStore = tx.objectStore(STORE_DIRS);
    const fileStore = tx.objectStore(STORE_FILES);

    const fileRecord = (await promisifyRequest(fileStore.get(srcP))) as FileRecord | undefined;
    if (fileRecord) {
      if (await promisifyRequest(dirStore.get(dstP))) {
        throw vfsError('EISDIR', dstP);
      }
      await this.validateParents(dstParent, fileStore);
      await this.enforcePolicy(dstP, dirStore, fileStore, function (snapshot): void {
        applyMoveToSnapshot(snapshot, srcP, dstP);
      });
      await this.ensureParents(dstParent, dirStore, fileStore);
      fileStore.put({
        path: dstP,
        data: new Uint8Array(fileRecord.data),
        mtimeMs: Date.now(),
      } satisfies FileRecord);
      fileStore.delete(srcP);
      await promisifyTransaction(tx);
      return { src: srcP, dst: dstP };
    }

    const dirRecord = await promisifyRequest(dirStore.get(srcP));
    if (!dirRecord) {
      throw vfsError('ENOENT', srcP);
    }
    if (isStrictDescendantPath(srcP, dstP)) {
      throw vfsError('EINVAL', dstP, { targetPath: srcP });
    }
    const dstDirExists = await promisifyRequest(dirStore.get(dstP));
    const dstFileExists = await promisifyRequest(fileStore.get(dstP));
    if (dstDirExists || dstFileExists) {
      throw vfsError('EEXIST', dstP);
    }

    await this.validateParents(dstParent, fileStore);
    await this.enforcePolicy(dstP, dirStore, fileStore, function (snapshot): void {
      applyMoveToSnapshot(snapshot, srcP, dstP);
    });
    await this.ensureParents(dstParent, dirStore, fileStore);
    dirStore.put({ path: dstP, mtimeMs: Date.now() } satisfies DirRecord);
    const prefix = srcP === '/' ? '/' : srcP + '/';

    const allDirs = (await promisifyRequest(dirStore.getAll())) as DirRecord[];
    for (const dir of allDirs) {
      if (dir.path.startsWith(prefix)) {
        dirStore.put({
          path: dstP + dir.path.slice(srcP.length),
          mtimeMs: Date.now(),
        } satisfies DirRecord);
      }
    }

    const allFiles = (await promisifyRequest(fileStore.getAll())) as FileRecord[];
    for (const file of allFiles) {
      if (file.path.startsWith(prefix)) {
        fileStore.put({
          path: dstP + file.path.slice(srcP.length),
          data: new Uint8Array(file.data),
          mtimeMs: Date.now(),
        } satisfies FileRecord);
      }
    }

    await promisifyTransaction(tx);
    await this.delete(srcP);
    return { src: srcP, dst: dstP };
  }

  async stat(inputPath: string): Promise<VFileInfo> {
    const p = this.normalize(inputPath);
    const tx = this.tx([STORE_DIRS, STORE_FILES], 'readonly');

    const dirRecord = (await promisifyRequest(tx.objectStore(STORE_DIRS).get(p))) as DirRecord | undefined;
    if (dirRecord) {
      return {
        path: p,
        exists: true,
        isDir: true,
        size: 0,
        mediaType: 'inode/directory',
        modifiedEpochMs: dirRecord.mtimeMs,
      };
    }

    const fileRecord = (await promisifyRequest(tx.objectStore(STORE_FILES).get(p))) as FileRecord | undefined;
    if (fileRecord) {
      return {
        path: p,
        exists: true,
        isDir: false,
        size: fileRecord.data.length,
        mediaType: guessMediaType(baseName(p), false),
        modifiedEpochMs: fileRecord.mtimeMs,
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
