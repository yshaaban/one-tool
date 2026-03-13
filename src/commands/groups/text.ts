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

  return ok(
    splitLines(text ?? '')
      .slice(0, value)
      .join('\n'),
  );
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

async function cmdSort(ctx: CommandContext, args: string[], stdin: Uint8Array) {
  let reverse = false;
  let numeric = false;
  let unique = false;
  let filePath: string | undefined;

  for (const arg of args) {
    if (arg === '-r') {
      reverse = true;
    } else if (arg === '-n') {
      numeric = true;
    } else if (arg === '-u') {
      unique = true;
    } else if (arg.startsWith('-')) {
      return err(`sort: unknown option: ${arg}. Usage: sort [-r] [-n] [-u] [path]`);
    } else if (filePath === undefined) {
      filePath = arg;
    } else {
      return err('sort: usage: sort [-r] [-n] [-u] [path]');
    }
  }

  const { text, error } = await readTextFromFileOrStdin(ctx, filePath, stdin, 'sort');
  if (error) {
    return error;
  }

  const lines = splitLines(text ?? '');
  const decorated = lines.map(function (line, index) {
    return { line, index };
  });

  decorated.sort(function (left, right) {
    const comparison = compareSortLines(left.line, right.line, numeric);
    if (comparison !== 0) {
      return reverse ? -comparison : comparison;
    }
    return left.index - right.index;
  });

  const sortedLines = decorated.map(function (entry) {
    return entry.line;
  });
  const outputLines = unique ? dedupeSortedLines(sortedLines) : sortedLines;

  return ok(outputLines.join('\n'));
}

export const sort: CommandSpec = {
  name: 'sort',
  summary: 'Sort lines from stdin or a file.',
  usage: 'sort [-r] [-n] [-u] [path]',
  details:
    'Examples:\n  sort /notes/todo.txt\n  cat /logs/app.log | sort\n  find /config --type file | sort -r',
  handler: cmdSort,
  acceptsStdin: true,
  minArgs: 0,
  conformanceArgs: [],
};

async function cmdUniq(ctx: CommandContext, args: string[], stdin: Uint8Array) {
  let count = false;
  let ignoreCase = false;
  let filePath: string | undefined;

  for (const arg of args) {
    if (arg === '-c') {
      count = true;
    } else if (arg === '-i') {
      ignoreCase = true;
    } else if (arg.startsWith('-')) {
      return err(`uniq: unknown option: ${arg}. Usage: uniq [-c] [-i] [path]`);
    } else if (filePath === undefined) {
      filePath = arg;
    } else {
      return err('uniq: usage: uniq [-c] [-i] [path]');
    }
  }

  const { text, error } = await readTextFromFileOrStdin(ctx, filePath, stdin, 'uniq');
  if (error) {
    return error;
  }

  const lines = splitLines(text ?? '');
  if (lines.length === 0) {
    return ok('');
  }

  const outputLines: string[] = [];
  let currentLine = lines[0]!;
  let currentKey = uniqKey(currentLine, ignoreCase);
  let currentCount = 1;

  for (const line of lines.slice(1)) {
    const key = uniqKey(line, ignoreCase);
    if (key === currentKey) {
      currentCount += 1;
      continue;
    }
    outputLines.push(renderUniqLine(currentLine, currentCount, count));
    currentLine = line;
    currentKey = key;
    currentCount = 1;
  }

  outputLines.push(renderUniqLine(currentLine, currentCount, count));

  return ok(outputLines.join('\n'));
}

export const uniq: CommandSpec = {
  name: 'uniq',
  summary: 'Collapse adjacent duplicate lines from stdin or a file.',
  usage: 'uniq [-c] [-i] [path]',
  details:
    'Examples:\n  sort /logs/errors.txt | uniq -c\n  cat /notes/todo.txt | uniq\n  uniq -i /tmp/names.txt',
  handler: cmdUniq,
  acceptsStdin: true,
  minArgs: 0,
  conformanceArgs: [],
};

async function cmdWc(ctx: CommandContext, args: string[], stdin: Uint8Array) {
  let countLinesOnly = false;
  let countWordsOnly = false;
  let countBytesOnly = false;
  let filePath: string | undefined;

  for (const arg of args) {
    if (arg === '-l') {
      countLinesOnly = true;
    } else if (arg === '-w') {
      countWordsOnly = true;
    } else if (arg === '-c') {
      countBytesOnly = true;
    } else if (arg.startsWith('-')) {
      return err(`wc: unknown option: ${arg}. Usage: wc [-l] [-w] [-c] [path]`);
    } else if (filePath === undefined) {
      filePath = arg;
    } else {
      return err('wc: usage: wc [-l] [-w] [-c] [path]');
    }
  }

  const { text, error } = await readTextFromFileOrStdin(ctx, filePath, stdin, 'wc');
  if (error) {
    return error;
  }

  const content = text ?? '';
  const lineCount = splitLines(content).length;
  const wordCount = countWords(content);
  const byteCount = new TextEncoder().encode(content).length;
  const requestedCounts = [
    { enabled: countLinesOnly, label: 'lines', value: lineCount },
    { enabled: countWordsOnly, label: 'words', value: wordCount },
    { enabled: countBytesOnly, label: 'bytes', value: byteCount },
  ].filter(function (entry) {
    return entry.enabled;
  });

  if (requestedCounts.length === 0) {
    return ok(`lines: ${lineCount}\nwords: ${wordCount}\nbytes: ${byteCount}`);
  }

  if (requestedCounts.length === 1) {
    return ok(String(requestedCounts[0]!.value));
  }

  return ok(
    requestedCounts
      .map(function (entry) {
        return `${entry.label}: ${entry.value}`;
      })
      .join('\n'),
  );
}

export const wc: CommandSpec = {
  name: 'wc',
  summary: 'Count lines, words, and bytes from stdin or a file.',
  usage: 'wc [-l] [-w] [-c] [path]',
  details: 'Examples:\n  wc /logs/app.log\n  wc -l /logs/app.log\n  fetch text:runbook | wc -w',
  handler: cmdWc,
  acceptsStdin: true,
  minArgs: 0,
  conformanceArgs: [],
};

function compareSortLines(left: string, right: string, numeric: boolean): number {
  if (!numeric) {
    return left.localeCompare(right);
  }

  const leftNumber = numericSortValue(left);
  const rightNumber = numericSortValue(right);

  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber === rightNumber ? left.localeCompare(right) : leftNumber - rightNumber;
  }
  if (leftNumber !== null) {
    return -1;
  }
  if (rightNumber !== null) {
    return 1;
  }

  return left.localeCompare(right);
}

function numericSortValue(line: string): number | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function dedupeSortedLines(lines: string[]): string[] {
  const output: string[] = [];

  for (const line of lines) {
    if (output[output.length - 1] !== line) {
      output.push(line);
    }
  }

  return output;
}

function uniqKey(line: string, ignoreCase: boolean): string {
  return ignoreCase ? line.toLowerCase() : line;
}

function renderUniqLine(line: string, count: number, includeCount: boolean): string {
  return includeCount ? `${count}\t${line}` : line;
}

function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches?.length ?? 0;
}

export const textCommands: CommandSpec[] = [grep, head, tail, sort, uniq, wc];
