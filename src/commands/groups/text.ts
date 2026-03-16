import {
  compileCLocaleRegex,
  compareCLocaleText,
  foldAsciiCaseText,
} from '../../c-locale.js';
import type { CommandResult } from '../../types.js';
import { err, ok, okBytes, textEncoder } from '../../types.js';
import {
  errorMessage,
  formatSize,
  looksBinary,
  splitLines,
} from '../../utils.js';
import type { CommandContext, CommandSpec } from '../core.js';
import { readBytesFromFileOrStdin } from '../shared/bytes.js';
import { readTextFromFileOrStdin } from '../shared/io.js';
import { createByteLineModel, encodeCLocaleText, normalizeCLocaleInputText } from '../shared/line-model.js';
import { runSedCommand } from '../shared/sed.js';
import { compileTrProgram } from '../shared/tr-arrays.js';

async function cmdEcho(_ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return err('echo: does not accept stdin');
  }

  const parsed = parseEchoArgs(args);
  const output = renderEchoOutput(parsed);
  return ok(output, { contentType: 'text/plain' });
}

interface EchoArgs {
  interpretEscapes: boolean;
  suppressTrailingNewline: boolean;
  words: string[];
}

function parseEchoArgs(args: string[]): EchoArgs {
  let interpretEscapes = false;
  let suppressTrailingNewline = false;
  const words: string[] = [];
  let parsingOptions = true;

  for (const arg of args) {
    if (!parsingOptions || arg === '-' || !arg.startsWith('-') || !/^-[nEe]+$/.test(arg)) {
      parsingOptions = false;
      words.push(arg);
      continue;
    }

    for (const flag of arg.slice(1)) {
      if (flag === 'n') {
        suppressTrailingNewline = true;
      } else if (flag === 'e') {
        interpretEscapes = true;
      } else if (flag === 'E') {
        interpretEscapes = false;
      }
    }
  }

  return {
    interpretEscapes,
    suppressTrailingNewline,
    words,
  };
}

function renderEchoOutput(args: EchoArgs): string {
  const decoded = decodeEchoEscapes(args.words.join(' '), args.interpretEscapes);
  if (decoded.suppressTrailingNewline || args.suppressTrailingNewline) {
    return decoded.text;
  }
  return `${decoded.text}\n`;
}

function decodeEchoEscapes(
  value: string,
  interpretEscapes: boolean,
): { suppressTrailingNewline: boolean; text: string } {
  if (!interpretEscapes) {
    return { suppressTrailingNewline: false, text: value };
  }

  let output = '';

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char !== '\\' || index === value.length - 1) {
      output += char;
      continue;
    }

    index += 1;
    const escape = value[index]!;
    if (escape === 'a') {
      output += '\u0007';
    } else if (escape === 'b') {
      output += '\b';
    } else if (escape === 'c') {
      return { suppressTrailingNewline: true, text: output };
    } else if (escape === 'e' || escape === 'E') {
      output += '\u001b';
    } else if (escape === 'f') {
      output += '\f';
    } else if (escape === 'n') {
      output += '\n';
    } else if (escape === 'r') {
      output += '\r';
    } else if (escape === 't') {
      output += '\t';
    } else if (escape === 'v') {
      output += '\v';
    } else if (escape === '\\') {
      output += '\\';
    } else {
      output += `\\${escape}`;
    }
  }

  return { suppressTrailingNewline: false, text: output };
}

export const echo: CommandSpec = {
  name: 'echo',
  summary: 'Write arguments back as plain text output. Supports -n, -e, and -E.',
  usage: 'echo [-n] [-e|-E] [text ...]',
  details:
    'Examples:\n  echo hello world\n  echo -n "ready for review"\n  echo -e "line 1\\nline 2"\n  echo status:ok | write /notes/status.txt',
  handler: cmdEcho,
  acceptsStdin: false,
  minArgs: 0,
  conformanceArgs: [],
};

const GREP_USAGE = 'grep [-i] [-v] [-c] [-n] [-F] [-E] [-o] [-w] [-x] [-q] <pattern> [path]';
const HEAD_USAGE = 'head [-n N|-c N|-N] [path]';
const TAIL_USAGE = 'tail [-n N|-c N|-N] [path]';
const SORT_USAGE = 'sort [-r] [-n] [-u] [-f] [-V] [path]';

async function cmdGrep(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (args.length === 0) {
    return err(`grep: usage: ${GREP_USAGE}`);
  }

  const parsedArgs = parseGrepArgs(args);
  if (!parsedArgs.ok) {
    return err(parsedArgs.error);
  }

  const { filePath, options, pattern } = parsedArgs.value;

  const input = await readBytesFromFileOrStdin(ctx, filePath, stdin, 'grep');
  if (input.error) {
    return input.error;
  }
  if (looksBinary(input.data)) {
    if (input.source === 'stdin') {
      return err(
        `grep: stdin is binary (${formatSize(input.data.length)}). ` +
          'Pipe text only, or save binary data to a file and inspect with stat.',
      );
    }
    return err(`grep: binary file (${formatSize(input.data.length)}): ${input.source}. Use: stat ${input.source}`);
  }

  const builtMatcher = buildGrepMatcher(pattern, options);
  if (!builtMatcher.ok) {
    return err(builtMatcher.error);
  }

  const matches = collectGrepMatches(
    createByteLineModel(input.data).lines.map(function (line) {
      return line.text;
    }),
    builtMatcher.value,
    options,
  );
  if (options.quiet) {
    return createSuccessfulGrepResult('', matches.length > 0);
  }

  if (options.countOnly) {
    return createSuccessfulGrepResult(String(matches.length), matches.length > 0);
  }

  return createSuccessfulGrepResult(formatGrepMatches(matches, options), matches.length > 0);
}

interface GrepOptions {
  countOnly: boolean;
  ignoreCase: boolean;
  invert: boolean;
  lineNumbers: boolean;
  matchMode: 'fixed' | 'regex';
  onlyMatching: boolean;
  quiet: boolean;
  wholeLine: boolean;
  wordMatch: boolean;
}

interface ParsedGrepArgs {
  filePath: string | undefined;
  options: GrepOptions;
  pattern: string;
}

interface GrepLineMatch {
  lineNumber: number;
  segments: string[];
}

interface GrepMatcher {
  search(line: string): string[];
}

function parseGrepArgs(args: string[]): { ok: true; value: ParsedGrepArgs } | { ok: false; error: string } {
  const options: GrepOptions = {
    countOnly: false,
    ignoreCase: false,
    invert: false,
    lineNumbers: false,
    matchMode: 'regex',
    onlyMatching: false,
    quiet: false,
    wholeLine: false,
    wordMatch: false,
  };
  const remaining: string[] = [];
  let parsingOptions = true;

  for (const arg of args) {
    if (!parsingOptions || arg === '-' || !arg.startsWith('-')) {
      remaining.push(arg);
      parsingOptions = false;
      continue;
    }
    if (arg === '--') {
      parsingOptions = false;
      continue;
    }

    for (const flag of arg.slice(1)) {
      if (flag === 'i') {
        options.ignoreCase = true;
      } else if (flag === 'v') {
        options.invert = true;
      } else if (flag === 'c') {
        options.countOnly = true;
      } else if (flag === 'n') {
        options.lineNumbers = true;
      } else if (flag === 'F') {
        options.matchMode = 'fixed';
      } else if (flag === 'E') {
        options.matchMode = 'regex';
      } else if (flag === 'o') {
        options.onlyMatching = true;
      } else if (flag === 'w') {
        options.wordMatch = true;
      } else if (flag === 'x') {
        options.wholeLine = true;
      } else if (flag === 'q') {
        options.quiet = true;
      } else {
        return {
          ok: false,
          error: `grep: unknown option: -${flag}. Usage: ${GREP_USAGE}`,
        };
      }
    }
  }

  if (remaining.length === 0) {
    return { ok: false, error: `grep: missing pattern. Usage: ${GREP_USAGE}` };
  }
  if (remaining.length > 2) {
    return { ok: false, error: `grep: too many arguments. Usage: ${GREP_USAGE}` };
  }

  return {
    ok: true,
    value: {
      filePath: remaining[1],
      options,
      pattern: remaining[0]!,
    },
  };
}

function buildGrepMatcher(
  pattern: string,
  options: GrepOptions,
): { ok: true; value: GrepMatcher } | { ok: false; error: string } {
  const normalizedPattern = normalizeCLocaleInputText(pattern);

  if (options.matchMode === 'fixed') {
    return {
      ok: true,
      value: createFixedGrepMatcher(normalizedPattern, options),
    };
  }

  let source = normalizedPattern;
  if (options.wordMatch) {
    source = `\\b(?:${source})\\b`;
  }
  if (options.wholeLine) {
    source = `^(?:${source})$`;
  }

  try {
    const regex = compileCLocaleRegex(source, 'g', options.ignoreCase);
    return {
      ok: true,
      value: createRegexGrepMatcher(regex),
    };
  } catch (caught) {
    return { ok: false, error: `grep: invalid regex: ${errorMessage(caught)}` };
  }
}

function createFixedGrepMatcher(pattern: string, options: GrepOptions): GrepMatcher {
  const needle = options.ignoreCase ? foldAsciiCaseText(pattern) : pattern;

  return {
    search(line: string): string[] {
      const haystack = options.ignoreCase ? foldAsciiCaseText(line) : line;

      if (options.wholeLine) {
        return haystack === needle ? [line] : [];
      }

      const matches: string[] = [];
      let startIndex = 0;

      while (needle.length > 0) {
        const matchIndex = haystack.indexOf(needle, startIndex);
        if (matchIndex === -1) {
          break;
        }
        if (!options.wordMatch || isWholeWordMatch(line, matchIndex, matchIndex + needle.length)) {
          matches.push(line.slice(matchIndex, matchIndex + needle.length));
        }
        startIndex = matchIndex + Math.max(needle.length, 1);
      }

      return matches;
    },
  };
}

function createRegexGrepMatcher(regex: RegExp): GrepMatcher {
  return {
    search(line: string): string[] {
      const matches: string[] = [];
      regex.lastIndex = 0;

      for (;;) {
        const match = regex.exec(line);
        if (match === null) {
          break;
        }
        matches.push(match[0]);
        if (match[0].length === 0) {
          regex.lastIndex += 1;
        }
      }

      return matches;
    },
  };
}

function collectGrepMatches(lines: string[], matcher: GrepMatcher, options: GrepOptions): GrepLineMatch[] {
  const matches: GrepLineMatch[] = [];

  for (const [index, line] of lines.entries()) {
    const segments = matcher.search(line);
    const hasMatch = segments.length > 0;
    const selected = options.invert ? !hasMatch : hasMatch;

    if (!selected) {
      continue;
    }

    matches.push({
      lineNumber: index + 1,
      segments: options.onlyMatching ? resolveDisplayedGrepSegments(line, segments, options) : [line],
    });
  }

  return matches;
}

function resolveDisplayedGrepSegments(line: string, segments: string[], options: GrepOptions): string[] {
  if (options.invert) {
    return [line];
  }
  if (segments.length > 0) {
    return segments;
  }
  return [line];
}

function formatGrepMatches(matches: GrepLineMatch[], options: GrepOptions): string {
  const outputLines: string[] = [];

  for (const match of matches) {
    const prefix = options.lineNumbers ? `${match.lineNumber}:` : '';
    for (const segment of match.segments) {
      outputLines.push(`${prefix}${segment}`);
    }
  }

  return outputLines.join('\n');
}

function createSuccessfulGrepResult(text: string, matched: boolean): CommandResult {
  const stdout = encodeCLocaleText(text);
  return {
    stdout,
    stderr: '',
    exitCode: matched ? 0 : 1,
    contentType: 'text/plain',
  };
}

function isWholeWordMatch(line: string, startIndex: number, endIndex: number): boolean {
  const previous = startIndex === 0 ? '' : line[startIndex - 1]!;
  const next = endIndex >= line.length ? '' : line[endIndex]!;
  return !isWordChar(previous) && !isWordChar(next);
}

function isWordChar(char: string): boolean {
  return /[0-9A-Za-z_]/.test(char);
}

export const grep: CommandSpec = {
  name: 'grep',
  summary: 'Filter lines by pattern. Supports a common GNU grep subset.',
  usage: GREP_USAGE,
  details:
    'Examples:\n  grep ERROR /logs/app.log\n  cat /logs/app.log | grep -i timeout\n  grep -F -o "timeout" /logs/app.log\n  grep -c "payment failed" /logs/app.log',
  handler: cmdGrep,
  acceptsStdin: true,
  minArgs: 1,
  conformanceArgs: ['pattern'],
};

async function cmdHead(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  const parsed = parseTextSliceArgs('head', args);
  if (!parsed.ok) {
    return err(parsed.error);
  }

  if (parsed.value.mode === 'bytes') {
    const input = await readBytesFromFileOrStdin(ctx, parsed.value.filePath, stdin, 'head');
    if (input.error !== undefined) {
      return input.error;
    }

    return renderSliceBytes(input.data.slice(0, parsed.value.count));
  }

  const { text, error } = await readTextFromFileOrStdin(ctx, parsed.value.filePath, stdin, 'head');
  if (error) {
    return error;
  }

  return ok(
    splitLineChunks(text)
      .slice(0, parsed.value.count)
      .join(''),
  );
}

export const head: CommandSpec = {
  name: 'head',
  summary: 'Show the first N lines or bytes from stdin or a file.',
  usage: HEAD_USAGE,
  details:
    'Examples:\n  head -n 20 /logs/app.log\n  head -c 16 /notes/todo.txt\n  search "refund API" | head -n 5',
  handler: cmdHead,
  acceptsStdin: true,
  minArgs: 0,
  conformanceArgs: [],
};

async function cmdTail(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  const parsed = parseTextSliceArgs('tail', args);
  if (!parsed.ok) {
    return err(parsed.error);
  }

  if (parsed.value.mode === 'bytes') {
    const input = await readBytesFromFileOrStdin(ctx, parsed.value.filePath, stdin, 'tail');
    if (input.error !== undefined) {
      return input.error;
    }

    const startIndex = Math.max(input.data.length - parsed.value.count, 0);
    return renderSliceBytes(input.data.slice(startIndex));
  }

  const { text, error } = await readTextFromFileOrStdin(ctx, parsed.value.filePath, stdin, 'tail');
  if (error) {
    return error;
  }

  const lines = splitLineChunks(text);
  return ok(lines.slice(Math.max(lines.length - parsed.value.count, 0)).join(''));
}

export const tail: CommandSpec = {
  name: 'tail',
  summary: 'Show the last N lines or bytes from stdin or a file.',
  usage: TAIL_USAGE,
  details:
    'Examples:\n  tail -n 20 /logs/app.log\n  tail -c 16 /notes/todo.txt\n  cat /logs/app.log | tail -n 50',
  handler: cmdTail,
  acceptsStdin: true,
  minArgs: 0,
  conformanceArgs: [],
};

async function cmdSort(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  const parsed = parseSortArgs(args);
  if (!parsed.ok) {
    return err(parsed.error);
  }

  const { text, error } = await readTextFromFileOrStdin(ctx, parsed.value.filePath, stdin, 'sort');
  if (error) {
    return error;
  }

  const lines = splitLines(text);
  const decorated: SortEntry[] = lines.map(function (line, index) {
    return { line, index };
  });

  decorated.sort(function (left, right) {
    let comparison = compareSortLines(left.line, right.line, parsed.value);
    if (comparison === 0 && !parsed.value.unique) {
      comparison = compareTextSortLines(left.line, right.line, false);
    }
    if (comparison !== 0) {
      return parsed.value.reverse ? -comparison : comparison;
    }
    return left.index - right.index;
  });

  const outputLines = parsed.value.unique
    ? dedupeSortedEntries(decorated, parsed.value)
    : decorated.map(function (entry) {
        return entry.line;
      });

  return ok(outputLines.join('\n'));
}

export const sort: CommandSpec = {
  name: 'sort',
  summary: 'Sort lines from stdin or a file.',
  usage: SORT_USAGE,
  details:
    'Examples:\n  sort /notes/todo.txt\n  sort -f /tmp/names.txt\n  sort -V /tmp/releases.txt\n  find /config -type f | sort -r',
  handler: cmdSort,
  acceptsStdin: true,
  minArgs: 0,
  conformanceArgs: [],
};

async function cmdSed(ctx: CommandContext, args: string[], stdin: Uint8Array) {
  if (args.length === 0) {
    return err('sed: missing script. Usage: sed [OPTION]... [SCRIPT] [INPUTFILE...]');
  }

  return runSedCommand(ctx, args, stdin);
}

export const sed: CommandSpec = {
  name: 'sed',
  summary: 'Stream editor with in-place editing, addresses, and substitutions.',
  usage: 'sed [OPTION]... [SCRIPT] [INPUTFILE...]',
  details:
    'Supports a GNU-compatible subset: addresses (line, $, /regex/, range), commands p/d/q/n/s/a/i/c, and options -n, -e, -f, -E, -i[SUFFIX]. Common clustered short options like -ne and -nEf<file> also work.\n' +
    'Examples:\n  sed "s/ERROR/WARN/" /logs/app.log\n  sed -n "1,5p" /logs/app.log\n  sed -i.bak "s/us-east-1/us-west-2/" /config/app.env',
  handler: cmdSed,
  acceptsStdin: true,
  minArgs: 1,
  conformanceArgs: ['s/a/A/'],
};

async function cmdTr(_ctx: CommandContext, args: string[], stdin: Uint8Array) {
  const compiled = compileTrProgram(args);
  if (!compiled.ok) {
    return err(`tr: ${compiled.error}`);
  }

  const output = compiled.value.run(stdin);
  return okBytes(output, looksBinary(output) ? 'application/octet-stream' : 'text/plain');
}

export const tr: CommandSpec = {
  name: 'tr',
  summary: 'Translate, delete, and squeeze bytes from stdin.',
  usage: 'tr [OPTION]... STRING1 [STRING2]',
  details:
    'Examples:\n  cat /logs/app.log | tr a-z A-Z\n  cat /notes.txt | tr -s " "\n  cat /data.txt | tr -d 0-9',
  handler: cmdTr,
  acceptsStdin: true,
  minArgs: 1,
  conformanceArgs: ['a-z', 'A-Z'],
};

const UNIQ_USAGE = 'uniq [-c] [-d] [-i] [-u] [path]';
const WC_USAGE = 'wc [-l] [-w] [-c] [path]';

async function cmdUniq(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  const parsed = parseUniqArgs(args);
  if (!parsed.ok) {
    return err(parsed.error);
  }

  const { text, error } = await readTextFromFileOrStdin(ctx, parsed.value.filePath, stdin, 'uniq');
  if (error) {
    return error;
  }

  const lines = splitLines(text);
  if (lines.length === 0) {
    return ok('');
  }

  const outputLines: string[] = [];
  let currentLine = lines[0]!;
  let currentKey = uniqKey(currentLine, parsed.value.ignoreCase);
  let currentCount = 1;

  for (const line of lines.slice(1)) {
    const key = uniqKey(line, parsed.value.ignoreCase);
    if (key === currentKey) {
      currentCount += 1;
      continue;
    }
    if (shouldIncludeUniqGroup(currentCount, parsed.value)) {
      outputLines.push(renderUniqLine(currentLine, currentCount, parsed.value.count));
    }
    currentLine = line;
    currentKey = key;
    currentCount = 1;
  }

  if (shouldIncludeUniqGroup(currentCount, parsed.value)) {
    outputLines.push(renderUniqLine(currentLine, currentCount, parsed.value.count));
  }

  return ok(outputLines.join('\n'));
}

export const uniq: CommandSpec = {
  name: 'uniq',
  summary: 'Collapse adjacent duplicate lines from stdin or a file.',
  usage: UNIQ_USAGE,
  details:
    'Examples:\n  sort /logs/errors.txt | uniq -c\n  sort /logs/errors.txt | uniq -d\n  cat /notes/todo.txt | uniq\n  uniq -i /tmp/names.txt',
  handler: cmdUniq,
  acceptsStdin: true,
  minArgs: 0,
  conformanceArgs: [],
};

async function cmdWc(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  const parsed = parseWcArgs(args);
  if (!parsed.ok) {
    return err(parsed.error);
  }

  const { text, error } = await readTextFromFileOrStdin(ctx, parsed.value.filePath, stdin, 'wc');
  if (error) {
    return error;
  }

  const counts = {
    byteCount: textEncoder.encode(text).length,
    lineCount: countLineBreaks(text),
    wordCount: countWords(text),
  };

  return ok(renderWcOutput(parsed.value, counts, ctx));
}

export const wc: CommandSpec = {
  name: 'wc',
  summary: 'Count lines, words, and bytes from stdin or a file.',
  usage: WC_USAGE,
  details: 'Examples:\n  wc /logs/app.log\n  wc -l /logs/app.log\n  fetch text:runbook | wc -w',
  handler: cmdWc,
  acceptsStdin: true,
  minArgs: 0,
  conformanceArgs: [],
};

interface TextSliceArgs {
  count: number;
  filePath: string | undefined;
  mode: 'bytes' | 'lines';
}

interface SortOptions {
  filePath: string | undefined;
  ignoreCase: boolean;
  numeric: boolean;
  reverse: boolean;
  unique: boolean;
  version: boolean;
}

interface SortEntry {
  index: number;
  line: string;
}

interface WcOptions {
  bytes: boolean;
  filePath: string | undefined;
  lines: boolean;
  words: boolean;
}

interface UniqOptions {
  count: boolean;
  duplicatesOnly: boolean;
  filePath: string | undefined;
  ignoreCase: boolean;
  uniqueOnly: boolean;
}

const ASCII_DIGIT_0 = 48;
const ASCII_DIGIT_9 = 57;
const VERSION_TOKEN_PATTERN = /[0-9]+|[^0-9]+/g;

function parseTextSliceArgs(
  commandName: 'head' | 'tail',
  args: string[],
): { ok: true; value: TextSliceArgs } | { ok: false; error: string } {
  let count = 10;
  let filePath: string | undefined;
  let mode: 'bytes' | 'lines' = 'lines';

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (/^-\d+$/.test(arg)) {
      count = Number.parseInt(arg.slice(1), 10);
      mode = 'lines';
      continue;
    }

    if (arg === '-n' || arg === '-c') {
      const value = args[index + 1];
      if (value === undefined) {
        return {
          ok: false,
          error: `${commandName}: missing value for ${arg}. Usage: ${textSliceUsage(commandName)}`,
        };
      }
      const parsedCount = parseSliceCountValue(value);
      if (parsedCount === null) {
        return { ok: false, error: `${commandName}: invalid integer for ${arg}: ${value}` };
      }
      count = parsedCount;
      mode = arg === '-c' ? 'bytes' : 'lines';
      index += 1;
      continue;
    }

    if (arg.startsWith('-n') && arg.length > 2) {
      const parsedCount = parseSliceCountValue(arg.slice(2));
      if (parsedCount === null) {
        return { ok: false, error: `${commandName}: invalid integer for -n: ${arg.slice(2)}` };
      }
      count = parsedCount;
      mode = 'lines';
      continue;
    }

    if (arg.startsWith('-c') && arg.length > 2) {
      const parsedCount = parseSliceCountValue(arg.slice(2));
      if (parsedCount === null) {
        return { ok: false, error: `${commandName}: invalid integer for -c: ${arg.slice(2)}` };
      }
      count = parsedCount;
      mode = 'bytes';
      continue;
    }

    if (arg.startsWith('-')) {
      return {
        ok: false,
        error: `${commandName}: unknown option: ${arg}. Usage: ${textSliceUsage(commandName)}`,
      };
    }

    if (filePath !== undefined) {
      return { ok: false, error: `${commandName}: usage: ${textSliceUsage(commandName)}` };
    }

    filePath = arg;
  }

  return { ok: true, value: { count, filePath, mode } };
}

function parseSortArgs(args: string[]): { ok: true; value: SortOptions } | { ok: false; error: string } {
  const options: SortOptions = {
    filePath: undefined,
    ignoreCase: false,
    numeric: false,
    reverse: false,
    unique: false,
    version: false,
  };

  for (const arg of args) {
    if (arg.startsWith('-') && arg !== '-') {
      for (const flag of arg.slice(1)) {
        if (flag === 'f') {
          options.ignoreCase = true;
        } else if (flag === 'n') {
          options.numeric = true;
        } else if (flag === 'r') {
          options.reverse = true;
        } else if (flag === 'u') {
          options.unique = true;
        } else if (flag === 'V') {
          options.version = true;
        } else {
          return {
            ok: false,
            error: `sort: unknown option: -${flag}. Usage: ${SORT_USAGE}`,
          };
        }
      }
    } else if (options.filePath === undefined) {
      options.filePath = arg;
    } else {
      return { ok: false, error: `sort: usage: ${SORT_USAGE}` };
    }
  }

  return { ok: true, value: options };
}

function parseWcArgs(args: string[]): { ok: true; value: WcOptions } | { ok: false; error: string } {
  const options: WcOptions = {
    bytes: false,
    filePath: undefined,
    lines: false,
    words: false,
  };

  for (const arg of args) {
    if (arg.startsWith('-') && arg !== '-') {
      for (const flag of arg.slice(1)) {
        if (flag === 'c') {
          options.bytes = true;
        } else if (flag === 'l') {
          options.lines = true;
        } else if (flag === 'w') {
          options.words = true;
        } else {
          return { ok: false, error: `wc: unknown option: -${flag}. Usage: ${WC_USAGE}` };
        }
      }
    } else if (options.filePath === undefined) {
      options.filePath = arg;
    } else {
      return { ok: false, error: `wc: usage: ${WC_USAGE}` };
    }
  }

  return { ok: true, value: options };
}

function parseUniqArgs(args: string[]): { ok: true; value: UniqOptions } | { ok: false; error: string } {
  const options: UniqOptions = {
    count: false,
    duplicatesOnly: false,
    filePath: undefined,
    ignoreCase: false,
    uniqueOnly: false,
  };

  for (const arg of args) {
    if (arg.startsWith('-') && arg !== '-') {
      for (const flag of arg.slice(1)) {
        if (flag === 'c') {
          options.count = true;
        } else if (flag === 'd') {
          options.duplicatesOnly = true;
        } else if (flag === 'i') {
          options.ignoreCase = true;
        } else if (flag === 'u') {
          options.uniqueOnly = true;
        } else {
          return {
            ok: false,
            error: `uniq: unknown option: -${flag}. Usage: ${UNIQ_USAGE}`,
          };
        }
      }
      continue;
    }

    if (options.filePath === undefined) {
      options.filePath = arg;
      continue;
    }

    if (arg.startsWith('-')) {
      return { ok: false, error: `uniq: unknown option: ${arg}. Usage: ${UNIQ_USAGE}` };
    }

    return { ok: false, error: `uniq: usage: ${UNIQ_USAGE}` };
  }

  return { ok: true, value: options };
}

function compareSortLines(left: string, right: string, options: SortOptions): number {
  if (options.version) {
    return compareVersionSortLines(left, right, options.ignoreCase);
  }

  if (!options.numeric) {
    return compareTextSortLines(left, right, options.ignoreCase);
  }

  const leftNumber = numericSortValue(left);
  const rightNumber = numericSortValue(right);

  if (leftNumber !== null && rightNumber !== null) {
    if (leftNumber === rightNumber) {
      return compareTextSortLines(left, right, options.ignoreCase);
    }

    return leftNumber - rightNumber;
  }
  if (leftNumber !== null) {
    return 1;
  }
  if (rightNumber !== null) {
    return -1;
  }

  return compareTextSortLines(left, right, options.ignoreCase);
}

function numericSortValue(line: string): number | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function dedupeSortedEntries(entries: SortEntry[], options: SortOptions): string[] {
  const output: string[] = [];
  let groupStart = 0;

  while (groupStart < entries.length) {
    let bestEntry = entries[groupStart]!;
    let groupEnd = groupStart + 1;

    while (
      groupEnd < entries.length &&
      sortLinesEquivalent(entries[groupStart]!.line, entries[groupEnd]!.line, options)
    ) {
      if (entries[groupEnd]!.index < bestEntry.index) {
        bestEntry = entries[groupEnd]!;
      }
      groupEnd += 1;
    }

    output.push(bestEntry.line);
    groupStart = groupEnd;
  }

  return output;
}

function sortLinesEquivalent(left: string, right: string, options: SortOptions): boolean {
  if (options.version) {
    return compareVersionSortLines(left, right, options.ignoreCase) === 0;
  }

  if (!options.numeric) {
    return compareTextSortLines(left, right, options.ignoreCase) === 0;
  }

  const leftNumber = numericSortValue(left);
  const rightNumber = numericSortValue(right);

  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber === rightNumber;
  }
  if (leftNumber !== null || rightNumber !== null) {
    return false;
  }

  return compareTextSortLines(left, right, options.ignoreCase) === 0;
}

function uniqKey(line: string, ignoreCase: boolean): string {
  return ignoreCase ? foldAsciiCaseText(line) : line;
}

function renderUniqLine(line: string, count: number, includeCount: boolean): string {
  return includeCount ? `${formatCountField(count)} ${line}` : line;
}

function shouldIncludeUniqGroup(count: number, options: UniqOptions): boolean {
  if (options.duplicatesOnly && options.uniqueOnly) {
    return false;
  }
  if (options.duplicatesOnly) {
    return count > 1;
  }
  if (options.uniqueOnly) {
    return count === 1;
  }
  return true;
}

function countLineBreaks(text: string): number {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  let count = 0;

  for (const char of normalized) {
    if (char === '\n') {
      count += 1;
    }
  }

  return count;
}

function splitLineChunks(text: string): string[] {
  if (text.length === 0) {
    return [];
  }

  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return normalized.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

function countWords(text: string): number {
  const matches = text.match(/\S+/g);
  return matches?.length ?? 0;
}

function compareTextSortLines(left: string, right: string, ignoreCase: boolean): number {
  return compareCLocaleText(left, right, ignoreCase);
}

function compareVersionSortLines(left: string, right: string, ignoreCase: boolean): number {
  const leftTokens = tokenizeVersionSortLine(left);
  const rightTokens = tokenizeVersionSortLine(right);
  const limit = Math.min(leftTokens.length, rightTokens.length);

  for (let index = 0; index < limit; index += 1) {
    const leftToken = leftTokens[index]!;
    const rightToken = rightTokens[index]!;
    const leftIsDigit = isAsciiDigitToken(leftToken);
    const rightIsDigit = isAsciiDigitToken(rightToken);

    let comparison = 0;
    if (leftIsDigit && rightIsDigit) {
      comparison = compareVersionNumberTokens(leftToken, rightToken);
    } else {
      comparison = compareCLocaleText(leftToken, rightToken, ignoreCase);
    }

    if (comparison !== 0) {
      return comparison;
    }
  }

  if (leftTokens.length < rightTokens.length) {
    return -1;
  }
  if (leftTokens.length > rightTokens.length) {
    return 1;
  }
  return 0;
}

function tokenizeVersionSortLine(value: string): string[] {
  return value.match(VERSION_TOKEN_PATTERN) ?? [];
}

function isAsciiDigitToken(value: string): boolean {
  if (value.length === 0) {
    return false;
  }
  const code = value.charCodeAt(0);
  return code >= ASCII_DIGIT_0 && code <= ASCII_DIGIT_9;
}

function compareVersionNumberTokens(left: string, right: string): number {
  const leftTrimmed = trimVersionLeadingZeros(left);
  const rightTrimmed = trimVersionLeadingZeros(right);

  if (leftTrimmed.length !== rightTrimmed.length) {
    return leftTrimmed.length - rightTrimmed.length;
  }
  if (leftTrimmed < rightTrimmed) {
    return -1;
  }
  if (leftTrimmed > rightTrimmed) {
    return 1;
  }
  if (left.length !== right.length) {
    return right.length - left.length;
  }
  return 0;
}

function trimVersionLeadingZeros(value: string): string {
  let index = 0;

  while (index < value.length - 1 && value.charCodeAt(index) === ASCII_DIGIT_0) {
    index += 1;
  }

  return value.slice(index);
}


function selectWcFields(
  options: WcOptions,
  lineCount: number,
  wordCount: number,
  byteCount: number,
): number[] {
  const fields = [
    { enabled: options.lines, value: lineCount },
    { enabled: options.words, value: wordCount },
    { enabled: options.bytes, value: byteCount },
  ].filter(function (field) {
    return field.enabled;
  });

  if (fields.length === 0) {
    return [lineCount, wordCount, byteCount];
  }

  return fields.map(function (field) {
    return field.value;
  });
}

function renderWcOutput(
  options: WcOptions,
  counts: { byteCount: number; lineCount: number; wordCount: number },
  ctx: CommandContext,
): string {
  const selectedCounts = selectWcFields(options, counts.lineCount, counts.wordCount, counts.byteCount);
  const renderedCounts = renderWcCounts(selectedCounts, options.filePath !== undefined);

  if (options.filePath === undefined) {
    return renderedCounts;
  }

  return `${renderedCounts} ${ctx.vfs.normalize(options.filePath)}`;
}

function renderWcCounts(counts: number[], hasFilePath: boolean): string {
  if (counts.length <= 1) {
    return String(counts[0] ?? 0);
  }

  const fieldWidth = hasFilePath ? longestCountWidth(counts) : 7;
  return counts
    .map(function (value) {
      return String(value).padStart(fieldWidth, ' ');
    })
    .join(' ');
}

function longestCountWidth(counts: number[]): number {
  return counts.reduce(function (width, value) {
    return Math.max(width, String(value).length);
  }, 1);
}

function parseSliceCountValue(value: string): number | null {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return parsed;
}

function renderSliceBytes(output: Uint8Array): CommandResult {
  return okBytes(output, looksBinary(output) ? 'application/octet-stream' : 'text/plain');
}

function textSliceUsage(commandName: 'head' | 'tail'): string {
  return commandName === 'head' ? HEAD_USAGE : TAIL_USAGE;
}

function formatCountField(value: number): string {
  return String(value).padStart(7, ' ');
}

export const textCommands: CommandSpec[] = [echo, grep, head, tail, sort, sed, tr, uniq, wc];
