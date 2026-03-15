import type { CommandResult } from '../../types.js';
import { err, textDecoder, textEncoder } from '../../types.js';
import { formatSize, looksBinary, parentPath } from '../../utils.js';
import type { CommandContext, CommandSpec } from '../core.js';
import { checkMaterializedByteLimit, formatMaterializedLimitMessage } from '../../execution-policy.js';

export function renderHelp(spec: CommandSpec): string {
  return `${spec.name}: ${spec.summary}\nUsage: ${spec.usage}\n\n${spec.details}`;
}

export type TextInputResult =
  | { text: string; error?: never }
  | { text?: never; error: CommandResult };

export async function readTextFromFileOrStdin(
  ctx: CommandContext,
  filePath: string | undefined,
  stdin: Uint8Array,
  commandName: string,
): Promise<TextInputResult> {
  if (filePath) {
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
    const raw = await ctx.vfs.readBytes(filePath);
    if (looksBinary(raw)) {
      return {
        error: err(
          `${commandName}: binary file (${formatSize(raw.length)}): ${normalized}. Use: stat ${normalized}`,
        ),
      };
    }
    return { text: textDecoder.decode(raw) };
  }

  if (stdin.length > 0) {
    const limitError = materializedLimitError(ctx, commandName, 'stdin', stdin.length);
    if (limitError !== undefined) {
      return { error: limitError };
    }
    if (looksBinary(stdin)) {
      return {
        error: err(
          `${commandName}: stdin is binary (${formatSize(stdin.length)}). ` +
            'Pipe text only, or save binary data to a file and inspect with stat.',
        ),
      };
    }
    return { text: textDecoder.decode(stdin) };
  }

  return {
    error: err(`${commandName}: no input provided. Usage: see 'help ${commandName}'`),
  };
}

export function contentFromArgsOrStdin(
  args: string[],
  stdin: Uint8Array,
  commandName: string,
): { ok: true; value: Uint8Array } | { ok: false; error: CommandResult } {
  if (args.length > 1) {
    return { ok: true, value: textEncoder.encode(args.slice(1).join(' ')) };
  }
  if (stdin.length > 0) {
    return { ok: true, value: stdin };
  }
  return {
    ok: false,
    error: err(`${commandName}: no content provided. Pass content inline or pipe it via stdin.`),
  };
}

export function parseNFlag(
  args: string[],
  defaultValue: number,
): { value: number; remaining: string[]; error?: CommandResult } {
  if (args.length === 0) {
    return { value: defaultValue, remaining: [] };
  }
  if (args[0] !== '-n') {
    return { value: defaultValue, remaining: args };
  }
  if (args.length < 2) {
    return { value: defaultValue, remaining: args, error: err('missing value for -n') };
  }
  const parsed = Number.parseInt(args[1]!, 10);
  if (!Number.isFinite(parsed)) {
    return {
      value: defaultValue,
      remaining: args,
      error: err(`invalid integer for -n: ${args[1]}`),
    };
  }
  return { value: parsed, remaining: args.slice(2) };
}

export function materializedLimitError(
  ctx: CommandContext,
  commandName: string,
  subject: string,
  actualBytes: number,
): CommandResult | undefined {
  const exceeded = checkMaterializedByteLimit(ctx.executionPolicy, actualBytes);
  if (!exceeded) {
    return undefined;
  }

  return err(formatMaterializedLimitMessage(commandName, subject, exceeded.actual, exceeded.limit), {
    exitCode: 1,
  });
}
