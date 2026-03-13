import { parentPath } from '../../utils.js';
import { toVfsError } from '../../vfs/errors.js';
import type { CommandContext } from '../core.js';

export function errorCode(caught: unknown): string | null {
  const vfsError = toVfsError(caught);
  if (vfsError) {
    return vfsError.code;
  }

  if (caught && typeof caught === 'object' && 'code' in caught) {
    const code = (caught as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return null;
}

export function errorPath(caught: unknown): string {
  const vfsError = toVfsError(caught);
  if (vfsError) {
    return vfsError.path;
  }
  return '';
}

export function errorTargetPath(caught: unknown): string | null {
  return toVfsError(caught)?.targetPath ?? null;
}

export async function firstFileInPath(ctx: CommandContext, inputPath: string): Promise<string | null> {
  const normalized = ctx.vfs.normalize(inputPath);
  if (normalized === '/') {
    return null;
  }

  let current = '';
  for (const segment of normalized.split('/').filter(Boolean)) {
    current += `/${segment}`;
    const info = await ctx.vfs.stat(current);
    if (info.exists && !info.isDir) {
      return current;
    }
  }

  return null;
}

export async function blockingParentPath(ctx: CommandContext, inputPath: string): Promise<string> {
  return (await firstFileInPath(ctx, parentPath(inputPath))) ?? parentPath(inputPath);
}
