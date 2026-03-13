export type VfsErrorCode =
  | 'ENOENT'
  | 'EISDIR'
  | 'ENOTDIR'
  | 'EEXIST'
  | 'EINVAL'
  | 'EROOT'
  | 'EESCAPE'
  | 'ERESOURCE_LIMIT';

export interface VfsErrorOptions {
  path: string;
  targetPath?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
  message?: string;
}

const VFS_ERROR_CODES = new Set<VfsErrorCode>([
  'ENOENT',
  'EISDIR',
  'ENOTDIR',
  'EEXIST',
  'EINVAL',
  'EROOT',
  'EESCAPE',
  'ERESOURCE_LIMIT',
]);

export class VfsError extends Error {
  readonly code: VfsErrorCode;
  readonly path: string;
  readonly targetPath: string | undefined;
  readonly details: Record<string, unknown> | undefined;

  constructor(code: VfsErrorCode, options: VfsErrorOptions) {
    super(options.message ?? `${code}:${options.path}`, options.cause ? { cause: options.cause } : undefined);
    this.name = 'VfsError';
    this.code = code;
    this.path = options.path;
    this.targetPath = options.targetPath;
    this.details = options.details;
  }
}

export function isVfsError(value: unknown): value is VfsError {
  return value instanceof VfsError;
}

export function toVfsError(value: unknown): VfsError | null {
  if (value instanceof VfsError) {
    return value;
  }

  if (value && typeof value === 'object') {
    const record = value as {
      code?: unknown;
      path?: unknown;
      targetPath?: unknown;
      details?: unknown;
      message?: unknown;
      cause?: unknown;
    };

    if (isVfsErrorCode(record.code) && typeof record.path === 'string') {
      const options: VfsErrorOptions = {
        path: record.path,
        cause: record.cause,
      };
      if (typeof record.targetPath === 'string') {
        options.targetPath = record.targetPath;
      }
      if (isPlainRecord(record.details)) {
        options.details = record.details;
      }
      if (typeof record.message === 'string') {
        options.message = record.message;
      }
      return new VfsError(record.code, {
        ...options,
      });
    }
  }

  if (!(value instanceof Error)) {
    return null;
  }

  if (value.message === 'cannot delete root') {
    return new VfsError('EROOT', { path: '/', cause: value });
  }
  if (value.message.startsWith('path escapes root: ')) {
    return new VfsError('EESCAPE', {
      path: value.message.slice('path escapes root: '.length),
      cause: value,
    });
  }

  const separator = value.message.indexOf(':');
  if (separator === -1) {
    return null;
  }

  const rawCode = value.message.slice(0, separator);
  if (!isVfsErrorCode(rawCode)) {
    return null;
  }

  return new VfsError(rawCode, {
    path: value.message.slice(separator + 1) || '/',
    cause: value,
    message: value.message,
  });
}

export function vfsError(
  code: VfsErrorCode,
  path: string,
  options: Omit<VfsErrorOptions, 'path'> = {},
): VfsError {
  return new VfsError(code, {
    ...options,
    path,
  });
}

function isVfsErrorCode(value: unknown): value is VfsErrorCode {
  return typeof value === 'string' && VFS_ERROR_CODES.has(value as VfsErrorCode);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
