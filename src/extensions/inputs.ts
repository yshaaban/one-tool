import type { CommandContext } from '../commands/index.js';
import { loadJson } from '../commands/shared/json.js';
import { readTextFromFileOrStdin } from '../commands/shared/io.js';
import { err } from '../types.js';
import { errorMessage } from '../utils.js';
import { vfsError } from '../vfs/errors.js';
import { formatVfsError } from './errors.js';
import { materializedLimitError } from '../commands/shared/io.js';
import { helperFailure, helperSuccess, type HelperResult } from './types.js';

export async function readTextInput(
  ctx: CommandContext,
  commandName: string,
  filePath: string | undefined,
  stdin: Uint8Array,
): Promise<HelperResult<string>> {
  return loadInput(ctx, commandName, filePath, async function (): Promise<HelperResult<string>> {
    const { text, error } = await readTextFromFileOrStdin(ctx, filePath, stdin, commandName);
    if (error !== undefined) {
      return helperFailure(error);
    }
    return helperSuccess(text ?? '');
  });
}

export async function readBytesInput(
  ctx: CommandContext,
  commandName: string,
  filePath: string | undefined,
  stdin: Uint8Array,
): Promise<HelperResult<Uint8Array>> {
  if (filePath !== undefined) {
    return loadInput(ctx, commandName, filePath, async function (): Promise<HelperResult<Uint8Array>> {
      const info = await ctx.vfs.stat(filePath);
      if (!info.exists) {
        return helperFailure(
          await formatVfsError(ctx, commandName, filePath, vfsError('ENOENT', ctx.vfs.normalize(filePath)), {
            notFoundLabel: 'file not found',
          }),
        );
      }
      if (info.isDir) {
        return helperFailure(
          await formatVfsError(ctx, commandName, filePath, vfsError('EISDIR', ctx.vfs.normalize(filePath))),
        );
      }
      const limitError = materializedLimitError(ctx, commandName, ctx.vfs.normalize(filePath), info.size);
      if (limitError !== undefined) {
        return helperFailure(limitError);
      }
      return helperSuccess(await ctx.vfs.readBytes(filePath));
    });
  }

  if (stdin.length > 0) {
    const limitError = materializedLimitError(ctx, commandName, 'stdin', stdin.length);
    if (limitError !== undefined) {
      return helperFailure(limitError);
    }
    return helperSuccess(new Uint8Array(stdin));
  }

  return helperFailure(err(`${commandName}: no input provided. Usage: see 'help ${commandName}'`));
}

export async function readJsonInput<T = unknown>(
  ctx: CommandContext,
  commandName: string,
  filePath: string | undefined,
  stdin: Uint8Array,
): Promise<HelperResult<T>> {
  return loadInput(ctx, commandName, filePath, async function (): Promise<HelperResult<T>> {
    const { value, error } = await loadJson(ctx, filePath, stdin, commandName);
    if (error !== undefined) {
      return helperFailure(error);
    }
    return helperSuccess(value as T);
  });
}

async function loadInput<T>(
  ctx: CommandContext,
  commandName: string,
  filePath: string | undefined,
  loader: () => Promise<HelperResult<T>>,
): Promise<HelperResult<T>> {
  try {
    return await loader();
  } catch (caught) {
    return handleInputFailure(ctx, commandName, filePath, caught);
  }
}

async function handleInputFailure<T>(
  ctx: CommandContext,
  commandName: string,
  filePath: string | undefined,
  caught: unknown,
): Promise<HelperResult<T>> {
  if (filePath !== undefined) {
    return helperFailure(
      await formatVfsError(ctx, commandName, filePath, caught, {
        notFoundLabel: 'file not found',
      }),
    );
  }

  return helperFailure(err(`${commandName}: ${errorMessage(caught)}`));
}
