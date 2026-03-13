import { parentOf } from './path-utils.js';
import { vfsError } from './errors.js';

export interface VfsResourcePolicy {
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxDirectoryDepth?: number;
  maxEntriesPerDirectory?: number;
  maxOutputArtifactBytes?: number;
}

export interface VfsSnapshot {
  files: Map<string, number>;
  dirs: Set<string>;
}

export interface VfsPolicyOptions {
  resourcePolicy?: VfsResourcePolicy;
}

export type ResolvedVfsResourcePolicy = Readonly<VfsResourcePolicy>;

const EMPTY_RESOURCE_POLICY: ResolvedVfsResourcePolicy = Object.freeze({});

export function resolveVfsResourcePolicy(policy?: VfsResourcePolicy): ResolvedVfsResourcePolicy {
  if (!policy) {
    return EMPTY_RESOURCE_POLICY;
  }

  const resolved: VfsResourcePolicy = {};
  validateLimit('maxFileBytes', policy.maxFileBytes);
  validateLimit('maxTotalBytes', policy.maxTotalBytes);
  validateLimit('maxDirectoryDepth', policy.maxDirectoryDepth);
  validateLimit('maxEntriesPerDirectory', policy.maxEntriesPerDirectory);
  validateLimit('maxOutputArtifactBytes', policy.maxOutputArtifactBytes);

  if (policy.maxFileBytes !== undefined) {
    resolved.maxFileBytes = policy.maxFileBytes;
  }
  if (policy.maxTotalBytes !== undefined) {
    resolved.maxTotalBytes = policy.maxTotalBytes;
  }
  if (policy.maxDirectoryDepth !== undefined) {
    resolved.maxDirectoryDepth = policy.maxDirectoryDepth;
  }
  if (policy.maxEntriesPerDirectory !== undefined) {
    resolved.maxEntriesPerDirectory = policy.maxEntriesPerDirectory;
  }
  if (policy.maxOutputArtifactBytes !== undefined) {
    resolved.maxOutputArtifactBytes = policy.maxOutputArtifactBytes;
  }

  return Object.freeze(resolved);
}

export function hasResourcePolicy(policy: ResolvedVfsResourcePolicy): boolean {
  return Object.keys(policy).length > 0;
}

export function cloneSnapshot(snapshot: VfsSnapshot): VfsSnapshot {
  return {
    files: new Map(snapshot.files),
    dirs: new Set(snapshot.dirs),
  };
}

export function createEmptySnapshot(): VfsSnapshot {
  return {
    files: new Map(),
    dirs: new Set(['/']),
  };
}

export function applyMkdirToSnapshot(snapshot: VfsSnapshot, path: string, parents: boolean): void {
  if (path === '/') {
    return;
  }

  if (parents) {
    ensureSnapshotParents(snapshot, path);
    return;
  }

  snapshot.dirs.add(path);
}

export function applyWriteToSnapshot(
  snapshot: VfsSnapshot,
  path: string,
  size: number,
  makeParents: boolean,
): void {
  if (makeParents) {
    ensureSnapshotParents(snapshot, parentOf(path));
  }
  snapshot.files.set(path, size);
}

export function applyAppendToSnapshot(
  snapshot: VfsSnapshot,
  path: string,
  sizeDelta: number,
  makeParents: boolean,
): void {
  if (makeParents) {
    ensureSnapshotParents(snapshot, parentOf(path));
  }
  snapshot.files.set(path, (snapshot.files.get(path) ?? 0) + sizeDelta);
}

export function applyDeleteToSnapshot(snapshot: VfsSnapshot, path: string): void {
  if (snapshot.files.has(path)) {
    snapshot.files.delete(path);
    return;
  }

  const prefix = `${path}/`;
  for (const filePath of [...snapshot.files.keys()]) {
    if (filePath.startsWith(prefix)) {
      snapshot.files.delete(filePath);
    }
  }
  for (const dirPath of [...snapshot.dirs]) {
    if (dirPath === path || dirPath.startsWith(prefix)) {
      snapshot.dirs.delete(dirPath);
    }
  }
  snapshot.dirs.add('/');
}

export function applyCopyToSnapshot(snapshot: VfsSnapshot, src: string, dst: string): void {
  if (snapshot.files.has(src)) {
    ensureSnapshotParents(snapshot, parentOf(dst));
    snapshot.files.set(dst, snapshot.files.get(src)!);
    return;
  }

  const prefix = src === '/' ? '/' : `${src}/`;
  ensureSnapshotParents(snapshot, parentOf(dst));
  snapshot.dirs.add(dst);

  for (const dirPath of [...snapshot.dirs]) {
    if (dirPath !== src && dirPath.startsWith(prefix)) {
      snapshot.dirs.add(dst + dirPath.slice(src.length));
    }
  }

  for (const [filePath, size] of snapshot.files.entries()) {
    if (filePath.startsWith(prefix)) {
      snapshot.files.set(dst + filePath.slice(src.length), size);
    }
  }
}

export function applyMoveToSnapshot(snapshot: VfsSnapshot, src: string, dst: string): void {
  if (src === dst) {
    return;
  }
  applyCopyToSnapshot(snapshot, src, dst);
  applyDeleteToSnapshot(snapshot, src);
}

export function enforceResourcePolicy(
  snapshot: VfsSnapshot,
  policy: ResolvedVfsResourcePolicy,
  contextPath: string,
): void {
  if (!hasResourcePolicy(policy)) {
    return;
  }

  let totalBytes = 0;
  const childrenByDir = new Map<string, number>();

  for (const dirPath of snapshot.dirs) {
    if (dirPath !== '/') {
      const depth = pathDepth(dirPath);
      if (policy.maxDirectoryDepth !== undefined && depth > policy.maxDirectoryDepth) {
        throw limitError(contextPath, 'maxDirectoryDepth', policy.maxDirectoryDepth, depth);
      }
      incrementChildCount(childrenByDir, parentOf(dirPath));
    }
  }

  for (const [filePath, size] of snapshot.files) {
    totalBytes += size;

    if (policy.maxFileBytes !== undefined && size > policy.maxFileBytes) {
      throw limitError(filePath, 'maxFileBytes', policy.maxFileBytes, size);
    }
    if (
      policy.maxOutputArtifactBytes !== undefined &&
      isRuntimeArtifactPath(filePath) &&
      size > policy.maxOutputArtifactBytes
    ) {
      throw limitError(filePath, 'maxOutputArtifactBytes', policy.maxOutputArtifactBytes, size);
    }

    incrementChildCount(childrenByDir, parentOf(filePath));
  }

  if (policy.maxTotalBytes !== undefined && totalBytes > policy.maxTotalBytes) {
    throw limitError(contextPath, 'maxTotalBytes', policy.maxTotalBytes, totalBytes);
  }

  if (policy.maxEntriesPerDirectory !== undefined) {
    for (const [dirPath, count] of childrenByDir) {
      if (count > policy.maxEntriesPerDirectory) {
        throw limitError(dirPath, 'maxEntriesPerDirectory', policy.maxEntriesPerDirectory, count);
      }
    }
  }
}

export function createSnapshotFromEntries(
  files: Iterable<[string, number]>,
  dirs: Iterable<string>,
): VfsSnapshot {
  return {
    files: new Map(files),
    dirs: new Set(dirs),
  };
}

export function isResourceLimitError(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    'code' in value &&
    (value as { code?: unknown }).code === 'ERESOURCE_LIMIT'
  );
}

function ensureSnapshotParents(snapshot: VfsSnapshot, path: string): void {
  if (path === '/') {
    snapshot.dirs.add('/');
    return;
  }

  const segments = path.split('/').filter(Boolean);
  let current = '';
  for (const segment of segments) {
    current += `/${segment}`;
    snapshot.dirs.add(current);
  }
}

function incrementChildCount(childrenByDir: Map<string, number>, dirPath: string): void {
  childrenByDir.set(dirPath, (childrenByDir.get(dirPath) ?? 0) + 1);
}

function pathDepth(path: string): number {
  return path.split('/').filter(Boolean).length;
}

function isRuntimeArtifactPath(path: string): boolean {
  return path.startsWith('/.system/cmd-output/');
}

function limitError(path: string, limitKind: keyof VfsResourcePolicy, limit: number, actual: number) {
  return vfsError('ERESOURCE_LIMIT', path, {
    details: {
      limitKind,
      limit,
      actual,
    },
  });
}

function validateLimit(name: string, value: number | undefined): void {
  if (value === undefined) {
    return;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
}
