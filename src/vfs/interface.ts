export interface VFileInfo {
  path: string;
  exists: boolean;
  isDir: boolean;
  size: number;
  mediaType: string;
  modifiedEpochMs: number;
}

export interface VFS {
  normalize(inputPath: string): string;
  exists(inputPath: string): Promise<boolean>;
  isDir(inputPath: string): Promise<boolean>;
  mkdir(inputPath: string, parents?: boolean): Promise<string>;
  listdir(inputPath?: string): Promise<string[]>;
  readBytes(inputPath: string): Promise<Uint8Array>;
  readText(inputPath: string): Promise<string>;
  writeBytes(inputPath: string, data: Uint8Array, makeParents?: boolean): Promise<string>;
  appendBytes(inputPath: string, data: Uint8Array, makeParents?: boolean): Promise<string>;
  delete(inputPath: string): Promise<string>;
  copy(src: string, dst: string): Promise<{ src: string; dst: string }>;
  move(src: string, dst: string): Promise<{ src: string; dst: string }>;
  stat(inputPath: string): Promise<VFileInfo>;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
};

export function guessMediaType(fileName: string, isDir: boolean): string {
  if (isDir) {
    return 'inode/directory';
  }
  const dot = fileName.lastIndexOf('.');
  if (dot === -1) {
    return 'application/octet-stream';
  }
  const ext = fileName.slice(dot).toLowerCase();
  return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream';
}
