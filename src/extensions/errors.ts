import type { CommandContext } from '../commands/index.js';
import { blockingParentPath, errorCode } from '../commands/shared/errors.js';
import type { CommandResult, ToolAdapters } from '../types.js';
import { err } from '../types.js';
import { errorMessage, parentPath } from '../utils.js';
import { toVfsError } from '../vfs/errors.js';

export interface FormatVfsErrorOptions {
  notFoundLabel?: string;
  directoryLabel?: string;
  notFoundHint?: string;
  directoryHint?: string;
}

export function usageError(commandName: string, usage: string): CommandResult {
  return err(`${commandName}: usage: ${usage}`);
}

export function stdinNotAcceptedError(commandName: string): CommandResult {
  return err(`${commandName}: does not accept stdin`);
}

export function missingAdapterError(commandName: string, adapterName: keyof ToolAdapters): CommandResult {
  return err(`${commandName}: no ${adapterName} adapter configured`);
}

export async function formatVfsError(
  ctx: CommandContext,
  commandName: string,
  inputPath: string,
  caught: unknown,
  options: FormatVfsErrorOptions = {},
): Promise<CommandResult> {
  const normalizedPath = ctx.vfs.normalize(inputPath);
  const code = errorCode(caught);

  if (code === 'ENOENT') {
    const hint = options.notFoundHint ?? `ls ${parentPath(normalizedPath)}`;
    return err(
      `${commandName}: ${options.notFoundLabel ?? 'path not found'}: ${normalizedPath}${formatHint(hint)}`,
    );
  }

  if (code === 'EISDIR') {
    const hint = options.directoryHint ?? `ls ${normalizedPath}`;
    return err(
      `${commandName}: ${options.directoryLabel ?? 'path is a directory'}: ${normalizedPath}${formatHint(hint)}`,
    );
  }

  if (code === 'ENOTDIR') {
    const blockedParent = await blockingParentPath(ctx, normalizedPath);
    return err(`${commandName}: parent is not a directory: ${blockedParent}`);
  }

  if (code === 'EESCAPE') {
    const escapedPath = toVfsError(caught)?.path ?? normalizedPath;
    return err(`${commandName}: path escapes workspace root: ${escapedPath}`);
  }

  if (code === 'EEXIST') {
    return err(`${commandName}: path already exists: ${normalizedPath}`);
  }

  if (code === 'ERESOURCE_LIMIT') {
    const vfsError = toVfsError(caught);
    const limitKind =
      typeof vfsError?.details?.limitKind === 'string' ? vfsError.details.limitKind : 'resource limit';
    const limit = typeof vfsError?.details?.limit === 'number' ? vfsError.details.limit : undefined;
    const actual = typeof vfsError?.details?.actual === 'number' ? vfsError.details.actual : undefined;
    if (limit !== undefined && actual !== undefined) {
      return err(
        `${commandName}: resource limit exceeded (${limitKind}: ${actual} > ${limit}) at ${normalizedPath}`,
      );
    }
    return err(`${commandName}: resource limit exceeded (${limitKind}) at ${normalizedPath}`);
  }

  return err(`${commandName}: ${errorMessage(caught)}`);
}

function formatHint(hint: string | undefined): string {
  if (!hint) {
    return '';
  }
  return `. Use: ${hint}`;
}
