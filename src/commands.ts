import type { MaybePromise, CommandResult, ToolAdapters } from './types.js';
import { err, ok, okBytes, textDecoder, textEncoder } from './types.js';
import type { VFS } from './vfs/interface.js';
import { SimpleMemory } from './memory.js';
import {
  errorMessage,
  formatSize,
  looksBinary,
  parentPath,
  safeEvalArithmetic,
  splitLines,
} from './utils.js';

export interface CommandSpec {
  name: string;
  summary: string;
  usage: string;
  details: string;
  handler: CommandHandler;
}

export type CommandHandler = (
  ctx: CommandContext,
  args: string[],
  stdin: Uint8Array,
) => MaybePromise<CommandResult>;

export class CommandRegistry {
  private readonly commands = new Map<string, CommandSpec>();

  register(spec: CommandSpec): void {
    if (this.commands.has(spec.name)) {
      throw new Error(`command already registered: ${spec.name}`);
    }
    this.commands.set(spec.name, spec);
  }

  get(name: string): CommandSpec | undefined {
    return this.commands.get(name);
  }

  all(): CommandSpec[] {
    return [...this.commands.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  names(): string[] {
    return [...this.commands.keys()].sort((left, right) => left.localeCompare(right));
  }
}

export interface CommandContext {
  vfs: VFS;
  adapters: ToolAdapters;
  memory: SimpleMemory;
  registry: CommandRegistry;
  outputDir: string;
  outputCounter: number;
}

function renderHelp(spec: CommandSpec): string {
  return `${spec.name}: ${spec.summary}\nUsage: ${spec.usage}\n\n${spec.details}`;
}

function errorCode(caught: unknown): string | null {
  if (caught && typeof caught === 'object' && 'code' in caught) {
    const code = (caught as { code?: unknown }).code;
    if (typeof code === 'string') {
      return code;
    }
  }
  return null;
}

function errorPath(message: string): string {
  const idx = message.indexOf(':');
  return idx === -1 ? '' : message.slice(idx + 1);
}

async function firstFileInPath(ctx: CommandContext, inputPath: string): Promise<string | null> {
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

async function blockingParentPath(ctx: CommandContext, inputPath: string): Promise<string> {
  return (await firstFileInPath(ctx, parentPath(inputPath))) ?? parentPath(inputPath);
}

async function readTextFromFileOrStdin(
  ctx: CommandContext,
  filePath: string | undefined,
  stdin: Uint8Array,
  commandName: string,
): Promise<{ text?: string; error?: CommandResult }> {
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

type ContentInput =
  | { ok: true; content: Uint8Array }
  | { ok: false; error: CommandResult };

function contentFromArgsOrStdin(
  args: string[],
  stdin: Uint8Array,
  commandName: string,
): ContentInput {
  if (args.length > 1) {
    return { ok: true, content: textEncoder.encode(args.slice(1).join(' ')) };
  }
  if (stdin.length > 0) {
    return { ok: true, content: stdin };
  }
  return {
    ok: false,
    error: err(`${commandName}: no content provided. Pass content inline or pipe it via stdin.`),
  };
}

function parseNFlag(
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
  const parsed = Number.parseInt(args[1] ?? '', 10);
  if (!Number.isFinite(parsed)) {
    return {
      value: defaultValue,
      remaining: args,
      error: err(`invalid integer for -n: ${args[1]}`),
    };
  }
  return { value: parsed, remaining: args.slice(2) };
}

async function loadJson(
  ctx: CommandContext,
  filePath: string | undefined,
  stdin: Uint8Array,
  commandName: string,
): Promise<{ value?: unknown; error?: CommandResult }> {
  const { text, error } = await readTextFromFileOrStdin(ctx, filePath, stdin, commandName);
  if (error) {
    return { error };
  }
  try {
    return { value: JSON.parse(text ?? '') };
  } catch (caught) {
    return { error: err(`${commandName}: invalid JSON: ${errorMessage(caught)}`) };
  }
}

function extractJsonPath(value: unknown, pathExpression: string): unknown {
  if (!pathExpression) {
    return value;
  }

  const tokens: Array<string | number> = [];

  for (const segment of pathExpression.split('.')) {
    if (!segment) {
      continue;
    }

    let cursor = 0;
    while (cursor < segment.length) {
      if (segment[cursor] === '[') {
        const end = segment.indexOf(']', cursor);
        if (end === -1) {
          throw new Error(`malformed path segment: ${segment}`);
        }
        const indexText = segment.slice(cursor + 1, end);
        tokens.push(Number.parseInt(indexText, 10));
        cursor = end + 1;
      } else {
        let end = cursor;
        while (end < segment.length && segment[end] !== '[') {
          end += 1;
        }
        tokens.push(segment.slice(cursor, end));
        cursor = end;
      }
    }
  }

  let current: unknown = value;
  for (const token of tokens) {
    if (typeof token === 'number') {
      if (!Array.isArray(current)) {
        throw new Error(String(token));
      }
      current = current[token];
      continue;
    }

    if (typeof current !== 'object' || current === null || !(token in current)) {
      throw new Error(token);
    }
    current = (current as Record<string, unknown>)[token];
  }

  return current;
}

async function cmdHelp(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return err('help: does not accept stdin');
  }

  if (args.length === 0) {
    const lines = ['Available commands:'];
    for (const spec of ctx.registry.all()) {
      lines.push(`  ${spec.name.padEnd(8, ' ')} — ${spec.summary}`);
    }
    lines.push('', 'Use: help <command>', 'Or run a command with no args to get its usage.');
    return ok(lines.join('\n'));
  }

  if (args.length !== 1) {
    return err('help: usage: help [command]');
  }

  const spec = ctx.registry.get(args[0]!);
  if (!spec) {
    return err(`help: unknown command: ${args[0]!}\nAvailable: ${ctx.registry.names().join(', ')}`);
  }

  return ok(renderHelp(spec));
}

async function cmdLs(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return err('ls: does not accept stdin');
  }
  if (args.length > 1) {
    return err('ls: usage: ls [path]');
  }

  const target = args[0] ?? '/';
  try {
    const entries = await ctx.vfs.listdir(target);
    return ok(entries.join('\n'));
  } catch (caught) {
    const message = errorMessage(caught);
    if (message.startsWith('ENOENT:')) {
      return err(`ls: path not found: ${ctx.vfs.normalize(target)}`);
    }
    if (message.startsWith('ENOTDIR:')) {
      const normalized = ctx.vfs.normalize(target);
      return err(`ls: not a directory: ${normalized}. Use: stat ${normalized}`);
    }
    return err(`ls: ${message}`);
  }
}

async function cmdStat(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return err('stat: does not accept stdin');
  }
  if (args.length !== 1) {
    return err('stat: usage: stat <path>');
  }

  const info = await ctx.vfs.stat(args[0]!);
  if (!info.exists) {
    return err(`stat: path not found: ${ctx.vfs.normalize(args[0]!)}`);
  }

  const lines = [
    `path: ${info.path}`,
    `type: ${info.isDir ? 'directory' : 'file'}`,
    `size: ${info.size} bytes`,
    `media_type: ${info.mediaType}`,
    `modified_epoch_ms: ${info.modifiedEpochMs}`,
  ];

  return ok(lines.join('\n'));
}

async function cmdCat(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return err('cat: does not accept stdin in this implementation. Use pipe targets like grep/head/tail/write.');
  }
  if (args.length !== 1) {
    return err('cat: usage: cat <path>');
  }

  const target = args[0]!;
  const info = await ctx.vfs.stat(target);
  const normalized = ctx.vfs.normalize(target);

  if (!info.exists) {
    return err(`cat: file not found: ${normalized}. Use: ls ${parentPath(target)}`);
  }
  if (info.isDir) {
    return err(`cat: path is a directory: ${normalized}. Use: ls ${normalized}`);
  }

  const raw = await ctx.vfs.readBytes(target);
  if (looksBinary(raw)) {
    return err(`cat: binary file (${formatSize(raw.length)}): ${normalized}. Use: stat ${normalized}`);
  }

  return okBytes(raw, 'text/plain');
}

async function cmdWrite(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (args.length === 0) {
    return err('write: usage: write <path> [content]');
  }

  const input = contentFromArgsOrStdin(args, stdin, 'write');
  if (!input.ok) {
    return input.error;
  }

  try {
    const saved = await ctx.vfs.writeBytes(args[0]!, input.content);
    return ok(`wrote ${formatSize(input.content.length)} to ${saved}`);
  } catch (caught) {
    const code = errorCode(caught);
    const message = errorMessage(caught);
    if (code === 'EISDIR' || message.startsWith('EISDIR:')) {
      const normalized = ctx.vfs.normalize(args[0]!);
      return err(`write: path is a directory: ${normalized}. Use: ls ${normalized}`);
    }
    if (code === 'ENOTDIR' || message.startsWith('ENOTDIR:')) {
      return err(`write: parent is not a directory: ${await blockingParentPath(ctx, args[0]!)}`);
    }
    if (code === 'EEXIST') {
      const blockingPath = await firstFileInPath(ctx, parentPath(args[0]!));
      if (blockingPath) {
        return err(`write: parent is not a directory: ${blockingPath}`);
      }
    }
    if (message.startsWith('ENOENT:')) {
      const missingParent = errorPath(message);
      return err(`write: parent path not found: ${missingParent}. Use: mkdir ${missingParent}`);
    }
    if (code === 'ENOENT') {
      const missingParent = parentPath(args[0]!);
      return err(`write: parent path not found: ${missingParent}. Use: mkdir ${missingParent}`);
    }
    return err(`write: ${message}`);
  }
}

async function cmdAppend(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (args.length === 0) {
    return err('append: usage: append <path> [content]');
  }

  const input = contentFromArgsOrStdin(args, stdin, 'append');
  if (!input.ok) {
    return input.error;
  }

  try {
    const saved = await ctx.vfs.appendBytes(args[0]!, input.content);
    return ok(`appended ${formatSize(input.content.length)} to ${saved}`);
  } catch (caught) {
    const code = errorCode(caught);
    const message = errorMessage(caught);
    if (code === 'EISDIR' || message.startsWith('EISDIR:')) {
      const normalized = ctx.vfs.normalize(args[0]!);
      return err(`append: path is a directory: ${normalized}. Use: ls ${normalized}`);
    }
    if (code === 'ENOTDIR' || message.startsWith('ENOTDIR:')) {
      return err(`append: parent is not a directory: ${await blockingParentPath(ctx, args[0]!)}`);
    }
    if (code === 'EEXIST') {
      const blockingPath = await firstFileInPath(ctx, parentPath(args[0]!));
      if (blockingPath) {
        return err(`append: parent is not a directory: ${blockingPath}`);
      }
    }
    if (message.startsWith('ENOENT:')) {
      const missingParent = errorPath(message);
      return err(`append: parent path not found: ${missingParent}. Use: mkdir ${missingParent}`);
    }
    if (code === 'ENOENT') {
      const missingParent = parentPath(args[0]!);
      return err(`append: parent path not found: ${missingParent}. Use: mkdir ${missingParent}`);
    }
    return err(`append: ${message}`);
  }
}

async function cmdGrep(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
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

async function cmdHead(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
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

async function cmdTail(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
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

async function cmdMkdir(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return err('mkdir: does not accept stdin');
  }
  if (args.length !== 1) {
    return err('mkdir: usage: mkdir <path>');
  }
  try {
    const created = await ctx.vfs.mkdir(args[0]!, true);
    return ok(`created ${created}`);
  } catch (caught) {
    const code = errorCode(caught);
    const message = errorMessage(caught);
    if (code === 'EEXIST' || message.startsWith('EEXIST:')) {
      return err(`mkdir: path already exists: ${ctx.vfs.normalize(args[0]!)}`);
    }
    if (code === 'ENOTDIR' || message.startsWith('ENOTDIR:')) {
      return err(`mkdir: parent is not a directory: ${await blockingParentPath(ctx, args[0]!)}`);
    }
    if (message.startsWith('ENOENT:')) {
      return err(`mkdir: parent path not found: ${errorPath(message)}`);
    }
    return err(`mkdir: ${message}`);
  }
}

async function cmdCp(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return err('cp: does not accept stdin');
  }
  if (args.length !== 2) {
    return err('cp: usage: cp <src> <dst>');
  }

  try {
    const { src, dst } = await ctx.vfs.copy(args[0]!, args[1]!);
    return ok(`copied ${src} -> ${dst}`);
  } catch (caught) {
    const code = errorCode(caught);
    const message = errorMessage(caught);
    if (code === 'ENOENT' || message.startsWith('ENOENT:')) {
      return err(`cp: source not found: ${ctx.vfs.normalize(args[0]!)}`);
    }
    if (code === 'EEXIST' || message.startsWith('EEXIST:')) {
      const blockingPath = await firstFileInPath(ctx, parentPath(args[1]!));
      if (blockingPath) {
        return err(`cp: parent is not a directory: ${blockingPath}`);
      }
      return err(`cp: destination already exists: ${ctx.vfs.normalize(args[1]!)}`);
    }
    if (code === 'EISDIR' || message.startsWith('EISDIR:')) {
      const normalized = ctx.vfs.normalize(args[1]!);
      return err(`cp: destination is a directory: ${normalized}. Use a file path.`);
    }
    if (code === 'ENOTDIR' || message.startsWith('ENOTDIR:')) {
      return err(`cp: parent is not a directory: ${await blockingParentPath(ctx, args[1]!)}`);
    }
    if (code === 'EINVAL' || message.startsWith('EINVAL:') || message.includes('EINVAL')) {
      return err(`cp: destination is inside the source directory: ${ctx.vfs.normalize(args[1]!)}`);
    }
    return err(`cp: ${message}`);
  }
}

async function cmdMv(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return err('mv: does not accept stdin');
  }
  if (args.length !== 2) {
    return err('mv: usage: mv <src> <dst>');
  }

  try {
    const { src, dst } = await ctx.vfs.move(args[0]!, args[1]!);
    return ok(`moved ${src} -> ${dst}`);
  } catch (caught) {
    const code = errorCode(caught);
    const message = errorMessage(caught);
    if (code === 'ENOENT' || message.startsWith('ENOENT:')) {
      return err(`mv: source not found: ${ctx.vfs.normalize(args[0]!)}`);
    }
    if (code === 'EEXIST' || message.startsWith('EEXIST:')) {
      const blockingPath = await firstFileInPath(ctx, parentPath(args[1]!));
      if (blockingPath) {
        return err(`mv: parent is not a directory: ${blockingPath}`);
      }
      return err(`mv: destination already exists: ${ctx.vfs.normalize(args[1]!)}`);
    }
    if (code === 'EISDIR' || message.startsWith('EISDIR:')) {
      const normalized = ctx.vfs.normalize(args[1]!);
      return err(`mv: destination is a directory: ${normalized}. Use a file path.`);
    }
    if (code === 'ENOTDIR' || message.startsWith('ENOTDIR:')) {
      return err(`mv: parent is not a directory: ${await blockingParentPath(ctx, args[1]!)}`);
    }
    if (code === 'EINVAL' || message.startsWith('EINVAL:')) {
      return err(`mv: destination is inside the source directory: ${ctx.vfs.normalize(args[1]!)}`);
    }
    return err(`mv: ${message}`);
  }
}

async function cmdRm(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return err('rm: does not accept stdin');
  }
  if (args.length !== 1) {
    return err('rm: usage: rm <path>');
  }

  try {
    const removed = await ctx.vfs.delete(args[0]!);
    return ok(`removed ${removed}`);
  } catch (caught) {
    const message = errorMessage(caught);
    if (message.startsWith('ENOENT:')) {
      return err(`rm: path not found: ${ctx.vfs.normalize(args[0]!)}`);
    }
    if (message === 'cannot delete root') {
      return err('rm: cannot delete root: /');
    }
    return err(`rm: ${message}`);
  }
}

async function cmdSearch(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return err('search: does not accept stdin');
  }
  if (args.length === 0) {
    return err('search: usage: search <query>');
  }
  if (!ctx.adapters.search) {
    return err(
      'search: no search adapter configured. Attach one to ToolAdapters(search: yourSearchAdapter).',
    );
  }

  const hits = await ctx.adapters.search.search(args.join(' '), 10);
  if (hits.length === 0) {
    return ok('(no results)');
  }

  const blocks = hits.map((hit, index) => {
    const lines = [`${index + 1}. ${hit.title}`];
    if (hit.source) {
      lines.push(`   source: ${hit.source}`);
    }
    if (hit.snippet) {
      lines.push(`   ${hit.snippet}`);
    }
    return lines.join('\n');
  });

  return ok(blocks.join('\n\n'));
}

function renderFetchPayload(payload: unknown, contentType: string): CommandResult {
  if (payload instanceof Uint8Array) {
    return okBytes(payload, contentType);
  }
  if (typeof payload === 'object' && payload !== null) {
    return ok(JSON.stringify(payload, null, 2), { contentType: 'application/json' });
  }
  return ok(String(payload ?? 'null'), { contentType });
}

async function cmdFetch(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return err('fetch: does not accept stdin');
  }
  if (args.length !== 1) {
    return err('fetch: usage: fetch <resource>');
  }
  if (!ctx.adapters.fetch) {
    return err(
      'fetch: no fetch adapter configured. Attach one to ToolAdapters(fetch: yourFetchAdapter).',
    );
  }

  try {
    const response = await ctx.adapters.fetch.fetch(args[0]!);
    return renderFetchPayload(response.payload, response.contentType);
  } catch (caught) {
    const message = errorMessage(caught);
    if (message.includes('not found')) {
      return err(`fetch: resource not found: ${args[0]!}`);
    }
    return err(`fetch: adapter error: ${message}`);
  }
}

async function cmdJson(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (args.length === 0) {
    return err('json: usage: json pretty [path] | json keys [path] | json get <field.path> [path]');
  }

  const sub = args[0]!;

  if (sub === 'pretty') {
    const filePath = args[1];
    if (args.length > 2) {
      return err('json: usage: json pretty [path]');
    }
    const { value, error } = await loadJson(ctx, filePath, stdin, 'json pretty');
    if (error) {
      return error;
    }
    return ok(JSON.stringify(value, null, 2), { contentType: 'application/json' });
  }

  if (sub === 'keys') {
    const filePath = args[1];
    if (args.length > 2) {
      return err('json: usage: json keys [path]');
    }
    const { value, error } = await loadJson(ctx, filePath, stdin, 'json keys');
    if (error) {
      return error;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return err('json keys: input must be a JSON object');
    }
    return ok(Object.keys(value as Record<string, unknown>).sort().join('\n'));
  }

  if (sub === 'get') {
    if (args.length < 2 || args.length > 3) {
      return err('json: usage: json get <field.path> [path]');
    }
    const pathExpression = args[1]!;
    const filePath = args[2];
    const { value, error } = await loadJson(ctx, filePath, stdin, 'json get');
    if (error) {
      return error;
    }
    try {
      const extracted = extractJsonPath(value, pathExpression);
      if (Array.isArray(extracted) || (typeof extracted === 'object' && extracted !== null)) {
        return ok(JSON.stringify(extracted, null, 2), { contentType: 'application/json' });
      }
      return ok(String(extracted));
    } catch (caught) {
      return err(`json get: path not found: ${pathExpression} (${errorMessage(caught)})`);
    }
  }

  return err('json: unknown subcommand. Use: json pretty | json keys | json get');
}

async function cmdMemory(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (args.length === 0) {
    return err('memory: usage: memory search <query> | memory recent [N] | memory store <text>');
  }

  const sub = args[0]!;

  if (sub === 'store') {
    let text = '';
    if (args.length > 1) {
      text = args.slice(1).join(' ');
    } else if (stdin.length > 0) {
      text = textDecoder.decode(stdin);
    } else {
      return err('memory store: provide text inline or via stdin');
    }

    const item = ctx.memory.store(text);
    return ok(`stored memory #${item.id}`);
  }

  if (sub === 'recent') {
    if (args.length > 2) {
      return err('memory recent: usage: memory recent [N]');
    }
    let limit = 10;
    if (args.length === 2) {
      const parsed = Number.parseInt(args[1]!, 10);
      if (!Number.isFinite(parsed)) {
        return err(`memory recent: invalid integer: ${args[1]!}`);
      }
      limit = parsed;
    }

    const items = ctx.memory.recent(limit);
    if (items.length === 0) {
      return ok('(no memories)');
    }
    return ok(items.map((item) => `#${item.id}  ${item.text}`).join('\n'));
  }

  if (sub === 'search') {
    if (args.length === 1 && stdin.length === 0) {
      return err('memory search: usage: memory search <query>');
    }
    const query = args.length > 1 ? args.slice(1).join(' ') : textDecoder.decode(stdin);
    const items = ctx.memory.search(query, 10);
    if (items.length === 0) {
      return ok('(no matches)');
    }
    return ok(items.map((item) => `#${item.id}  ${item.text}`).join('\n'));
  }

  return err('memory: unknown subcommand. Use: memory search | memory recent | memory store');
}

async function cmdCalc(_ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return err('calc: does not accept stdin');
  }
  if (args.length === 0) {
    return err('calc: usage: calc <expression>');
  }

  try {
    const value = safeEvalArithmetic(args.join(' '));
    return ok(String(value));
  } catch (caught) {
    return err(`calc: invalid expression: ${errorMessage(caught)}`);
  }
}

export function registerBuiltinCommands(registry: CommandRegistry): void {
  registry.register({
    name: 'help',
    summary: 'List commands or show detailed help for one command.',
    usage: 'help [command]',
    details: 'Examples:\n  help\n  help grep\n  grep',
    handler: cmdHelp,
  });
  registry.register({
    name: 'ls',
    summary: 'List files or directories in the rooted virtual file system.',
    usage: 'ls [path]',
    details: 'Examples:\n  ls\n  ls /logs\n  ls notes',
    handler: cmdLs,
  });
  registry.register({
    name: 'stat',
    summary: 'Show file metadata such as size, type, and modified time.',
    usage: 'stat <path>',
    details: 'Examples:\n  stat /logs/app.log\n  stat notes/todo.txt',
    handler: cmdStat,
  });
  registry.register({
    name: 'cat',
    summary: 'Read a text file. For directories use ls. For binary use stat.',
    usage: 'cat <path>',
    details: 'Examples:\n  cat /notes/todo.txt\n  cat logs/app.log',
    handler: cmdCat,
  });
  registry.register({
    name: 'write',
    summary: 'Write a file from inline content or stdin.',
    usage: 'write <path> [content]',
    details: 'Examples:\n  write /notes/todo.txt "line one"\n  search "refund issue" | write /reports/refund.txt',
    handler: cmdWrite,
  });
  registry.register({
    name: 'append',
    summary: 'Append to a file from inline content or stdin.',
    usage: 'append <path> [content]',
    details: 'Examples:\n  append /notes/todo.txt "next item"\n  cat /tmp/out.txt | append /notes/archive.txt',
    handler: cmdAppend,
  });
  registry.register({
    name: 'grep',
    summary: 'Filter lines by regex. Supports -i, -v, -c, -n.',
    usage: 'grep [-i] [-v] [-c] [-n] <pattern> [path]',
    details:
      'Examples:\n  grep ERROR /logs/app.log\n  cat /logs/app.log | grep -i timeout\n  grep -c "payment failed" /logs/app.log',
    handler: cmdGrep,
  });
  registry.register({
    name: 'head',
    summary: 'Show the first N lines from stdin or a file.',
    usage: 'head [-n N] [path]',
    details: 'Examples:\n  head -n 20 /logs/app.log\n  search "refund API" | head -n 5',
    handler: cmdHead,
  });
  registry.register({
    name: 'tail',
    summary: 'Show the last N lines from stdin or a file.',
    usage: 'tail [-n N] [path]',
    details: 'Examples:\n  tail -n 20 /logs/app.log\n  cat /logs/app.log | tail -n 50',
    handler: cmdTail,
  });
  registry.register({
    name: 'mkdir',
    summary: 'Create a directory and any missing parents.',
    usage: 'mkdir <path>',
    details: 'Examples:\n  mkdir /reports\n  mkdir notes/archive/2026',
    handler: cmdMkdir,
  });
  registry.register({
    name: 'cp',
    summary: 'Copy a file or directory inside the rooted virtual file system.',
    usage: 'cp <src> <dst>',
    details: 'Examples:\n  cp /drafts/qbr.md /reports/qbr-v1.md',
    handler: cmdCp,
  });
  registry.register({
    name: 'mv',
    summary: 'Move or rename a file or directory.',
    usage: 'mv <src> <dst>',
    details: 'Examples:\n  mv /drafts/qbr.md /archive/qbr.md',
    handler: cmdMv,
  });
  registry.register({
    name: 'rm',
    summary: 'Delete a file or directory recursively.',
    usage: 'rm <path>',
    details: 'Examples:\n  rm /tmp/out.txt\n  rm /scratch',
    handler: cmdRm,
  });
  registry.register({
    name: 'search',
    summary: 'Query your configured search tool and return text results.',
    usage: 'search <query>',
    details: 'Examples:\n  search "refund timeout incident"\n  search "acme renewal risk" | head -n 5',
    handler: cmdSearch,
  });
  registry.register({
    name: 'fetch',
    summary: 'Call your configured fetch tool and return text or JSON.',
    usage: 'fetch <resource>',
    details: 'Examples:\n  fetch order:123\n  fetch crm/customer/acme | json get owner.email',
    handler: cmdFetch,
  });
  registry.register({
    name: 'json',
    summary: 'Inspect JSON from stdin or a file: pretty, keys, get.',
    usage: 'json pretty [path] | json keys [path] | json get <field.path> [path]',
    details:
      'Examples:\n  fetch order:123 | json pretty\n  fetch order:123 | json get customer.email\n  json keys /config/default.json',
    handler: cmdJson,
  });
  registry.register({
    name: 'memory',
    summary: 'Search, store, or inspect lightweight working memory.',
    usage: 'memory search <query> | memory recent [N] | memory store <text>',
    details:
      'Examples:\n  memory store "Acme prefers Monday follow-ups"\n  memory search "Acme follow-up"\n  memory recent 5',
    handler: cmdMemory,
  });
  registry.register({
    name: 'calc',
    summary: 'Evaluate a safe arithmetic expression.',
    usage: 'calc <expression>',
    details: 'Examples:\n  calc 41 + 1\n  calc (12 * 8) / 3',
    handler: cmdCalc,
  });
}
