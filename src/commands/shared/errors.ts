import { parentPath } from '../../utils.js';
import type { CommandContext } from '../core.js';

export function errorCode(caught: unknown): string | null {
  if (caught && typeof caught === 'object' && 'code' in caught) {
    const code = (caught as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return null;
}

export function errorPath(message: string): string {
  const idx = message.indexOf(':');
  return idx === -1 ? '' : message.slice(idx + 1);
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
