import type { CommandContext } from '../commands/index.js';
import { blockingParentPath, errorCode } from '../commands/shared/errors.js';
import type { CommandResult, ToolAdapters } from '../types.js';
import { err } from '../types.js';
import { errorMessage, parentPath } from '../utils.js';

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
  const code = getVfsErrorCode(caught);

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

  if (code === 'EEXIST') {
    return err(`${commandName}: path already exists: ${normalizedPath}`);
  }

  return err(`${commandName}: ${errorMessage(caught)}`);
}

function formatHint(hint: string | undefined): string {
  if (!hint) {
    return '';
  }
  return `. Use: ${hint}`;
}

function getVfsErrorCode(caught: unknown): string | null {
  const code = errorCode(caught);
  if (code !== null) {
    return code;
  }

  const message = errorMessage(caught);
  const separator = message.indexOf(':');
  if (separator === -1) {
    return null;
  }

  const prefix = message.slice(0, separator);
  return /^[A-Z]+$/.test(prefix) ? prefix : null;
}
