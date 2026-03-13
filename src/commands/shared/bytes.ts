import type { CommandResult } from '../../types.js';
import { err } from '../../types.js';
import { parentPath } from '../../utils.js';
import type { CommandContext } from '../core.js';
import { materializedLimitError } from './io.js';

export type BytesInputResult =
  | { data: Uint8Array; source: string; error?: never }
  | { error: CommandResult; data?: never; source?: never };

export async function readBytesFromFileOrStdin(
  ctx: CommandContext,
  filePath: string | undefined,
  stdin: Uint8Array,
  commandName: string,
): Promise<BytesInputResult> {
  if (filePath !== undefined) {
    const info = await ctx.vfs.stat(filePath);
    const normalized = ctx.vfs.normalize(filePath);

    if (!info.exists) {
      return {
        error: err(`${commandName}: file not found: ${normalized}. Use: ls / or ls ${parentPath(filePath)}`),
      };
    }
    if (info.isDir) {
      return {
        error: err(`${commandName}: path is a directory: ${normalized}. Use: ls ${normalized}`),
      };
    }

    const limitError = materializedLimitError(ctx, commandName, normalized, info.size);
    if (limitError !== undefined) {
      return { error: limitError };
    }

    return {
      data: await ctx.vfs.readBytes(filePath),
      source: normalized,
    };
  }

  if (stdin.length > 0) {
    const limitError = materializedLimitError(ctx, commandName, 'stdin', stdin.length);
    if (limitError !== undefined) {
      return { error: limitError };
    }

    return {
      data: new Uint8Array(stdin),
      source: 'stdin',
    };
  }

  return {
    error: err(`${commandName}: no input provided. Usage: see 'help ${commandName}'`),
  };
}
