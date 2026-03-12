import { err, ok } from '../../types.js';
import { errorMessage, splitLines } from '../../utils.js';
import type { CommandContext, CommandSpec } from '../core.js';
import { parseNFlag, readTextFromFileOrStdin } from '../shared/io.js';

async function cmdGrep(ctx: CommandContext, args: string[], stdin: Uint8Array) {
  if (args.length === 0) {
    return err('grep: usage: grep [-i] [-v] [-c] [-n] <pattern> [path]');
  }

  let ignoreCase = false;
  let invert = false;
  let countOnly = false;
  let lineNumbers = false;
  const remaining: string[] = [];

  for (const arg of args) {
    if (arg === '-i') {
      ignoreCase = true;
    } else if (arg === '-v') {
      invert = true;
    } else if (arg === '-c') {
      countOnly = true;
    } else if (arg === '-n') {
      lineNumbers = true;
    } else {
      remaining.push(arg);
    }
  }

  if (remaining.length === 0) {
    return err('grep: missing pattern. Usage: grep [-i] [-v] [-c] [-n] <pattern> [path]');
  }

  const pattern = remaining[0]!;
  const filePath = remaining[1];
  if (remaining.length > 2) {
    return err('grep: too many arguments. Usage: grep [-i] [-v] [-c] [-n] <pattern> [path]');
  }

  const { text, error } = await readTextFromFileOrStdin(ctx, filePath, stdin, 'grep');
  if (error) {
    return error;
  }

  let compiled: RegExp;
  try {
    compiled = new RegExp(pattern, ignoreCase ? 'i' : '');
  } catch (caught) {
    return err(`grep: invalid regex: ${errorMessage(caught)}`);
  }

  const outLines: string[] = [];
  let matchCount = 0;

  for (const [index, line] of splitLines(text ?? '').entries()) {
    let matched = compiled.test(line);
    if (invert) {
      matched = !matched;
    }
    if (!matched) {
      continue;
    }
    matchCount += 1;
    if (!countOnly) {
      const prefix = lineNumbers ? `${index + 1}:` : '';
      outLines.push(`${prefix}${line}`);
    }
  }

  return countOnly ? ok(String(matchCount)) : ok(outLines.join('\n'));
}

export const grep: CommandSpec = {
  name: 'grep',
  summary: 'Filter lines by regex. Supports -i, -v, -c, -n.',
  usage: 'grep [-i] [-v] [-c] [-n] <pattern> [path]',
  details:
    'Examples:\n  grep ERROR /logs/app.log\n  cat /logs/app.log | grep -i timeout\n  grep -c "payment failed" /logs/app.log',
  handler: cmdGrep,
  acceptsStdin: true,
  minArgs: 1,
  conformanceArgs: ['pattern'],
};

async function cmdHead(ctx: CommandContext, args: string[], stdin: Uint8Array) {
  const { value, remaining, error: flagError } = parseNFlag(args, 10);
  if (flagError) {
    return err(`head: ${flagError.stderr}`);
  }
  if (remaining.length > 1) {
    return err('head: usage: head [-n N] [path]');
  }

  const filePath = remaining[0] as string | undefined;
  const { text, error } = await readTextFromFileOrStdin(ctx, filePath, stdin, 'head');
  if (error) {
    return error;
  }

  return ok(splitLines(text ?? '').slice(0, value).join('\n'));
}

export const head: CommandSpec = {
  name: 'head',
  summary: 'Show the first N lines from stdin or a file.',
  usage: 'head [-n N] [path]',
  details: 'Examples:\n  head -n 20 /logs/app.log\n  search "refund API" | head -n 5',
  handler: cmdHead,
  acceptsStdin: true,
  minArgs: 0,
  conformanceArgs: [],
};

async function cmdTail(ctx: CommandContext, args: string[], stdin: Uint8Array) {
  const { value, remaining, error: flagError } = parseNFlag(args, 10);
  if (flagError) {
    return err(`tail: ${flagError.stderr}`);
  }
  if (remaining.length > 1) {
    return err('tail: usage: tail [-n N] [path]');
  }

  const filePath = remaining[0] as string | undefined;
  const { text, error } = await readTextFromFileOrStdin(ctx, filePath, stdin, 'tail');
  if (error) {
    return error;
  }

  const lines = splitLines(text ?? '');
  return ok(lines.slice(Math.max(lines.length - value, 0)).join('\n'));
}

export const tail: CommandSpec = {
  name: 'tail',
  summary: 'Show the last N lines from stdin or a file.',
  usage: 'tail [-n N] [path]',
  details: 'Examples:\n  tail -n 20 /logs/app.log\n  cat /logs/app.log | tail -n 50',
  handler: cmdTail,
  acceptsStdin: true,
  minArgs: 0,
  conformanceArgs: [],
};

export const textCommands: CommandSpec[] = [grep, head, tail];
