import type { CommandResult } from '../../types.js';
import { err, ok, okBytes } from '../../types.js';
import { errorMessage, formatSize, looksBinary, parentPath } from '../../utils.js';
import { formatEscapePathErrorMessage, formatResourceLimitErrorMessage } from '../../vfs/errors.js';
import { baseName } from '../../vfs/path-utils.js';
import type { VFileInfo } from '../../vfs/interface.js';
import type { CommandContext, CommandSpec } from '../core.js';
import { blockingParentPath, errorCode, errorPath, firstFileInPath } from '../shared/errors.js';
import { parseDiffArgs, runDiffCommand } from '../shared/diff.js';
import { contentFromArgsOrStdin, materializedLimitError } from '../shared/io.js';

const LS_USAGE = 'ls [-1aRl] [path]';
const FIND_USAGE =
  'find [path] [--type file|dir|-type f|-type d] [--name pattern|-name pattern] [--max-depth N|-maxdepth N]';

interface LsOptions {
  all: boolean;
  long: boolean;
  recursive: boolean;
  targetPath: string;
}

interface LsEntry {
  displayName: string;
  isSynthetic: boolean;
  info: VFileInfo;
}

function resourceLimitMessage(commandName: string, caught: unknown): string | null {
  return formatResourceLimitErrorMessage(commandName, caught);
}

function escapePathMessage(commandName: string, caught: unknown, fallbackPath: string): string {
  return (
    formatEscapePathErrorMessage(commandName, caught, fallbackPath) ??
    `${commandName}: path escapes workspace root: ${errorPath(caught) || fallbackPath}`
  );
}

function escapePathResult(commandName: string, caught: unknown, fallbackPath: string): CommandResult | null {
  if (errorCode(caught) !== 'EESCAPE') {
    return null;
  }

  return err(escapePathMessage(commandName, caught, fallbackPath));
}

async function cmdLs(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return err('ls: does not accept stdin');
  }

  const parsed = parseLsArgs(args);
  if (!parsed.ok) {
    return err(parsed.error);
  }

  const options = parsed.value;
  const target = options.targetPath;
  try {
    const info = await ctx.vfs.stat(target);
    if (!info.exists) {
      return err(`ls: path not found: ${ctx.vfs.normalize(target)}`);
    }

    if (!info.isDir) {
      return ok(renderLsOutput([createLsEntry(info.path, info)], options));
    }

    if (options.recursive) {
      const sections = await collectLsSections(ctx, info.path, options);
      return ok(renderRecursiveLsOutput(sections, options));
    }

    const entries = await listLsEntries(ctx, info.path, options);
    return ok(renderLsOutput(entries, options));
  } catch (caught) {
    const code = errorCode(caught);
    if (code === 'ENOENT') {
      return err(`ls: path not found: ${ctx.vfs.normalize(target)}`);
    }
    if (code === 'EESCAPE') {
      return err(escapePathMessage('ls', caught, ctx.vfs.normalize(target)));
    }
    if (code === 'ENOTDIR') {
      const normalized = ctx.vfs.normalize(target);
      return err(`ls: not a directory: ${normalized}. Use: stat ${normalized}`);
    }
    return err(`ls: ${errorMessage(caught)}`);
  }
}

export const ls: CommandSpec = {
  name: 'ls',
  summary: 'List files or directories in the rooted virtual file system.',
  usage: LS_USAGE,
  details: 'Examples:\n  ls\n  ls -a /\n  ls -R /logs\n  ls -l notes',
  handler: cmdLs,
  acceptsStdin: false,
  minArgs: 0,
  conformanceArgs: ['/'],
};

async function cmdStat(ctx: CommandContext, args: string[], stdin: Uint8Array) {
  if (stdin.length > 0) {
    return err('stat: does not accept stdin');
  }
  if (args.length !== 1) {
    return err('stat: usage: stat <path>');
  }

  try {
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
  } catch (caught) {
    const escapeResult = escapePathResult('stat', caught, ctx.vfs.normalize(args[0]!));
    if (escapeResult !== null) {
      return escapeResult;
    }
    return err(`stat: ${errorMessage(caught)}`);
  }
}

export const stat: CommandSpec = {
  name: 'stat',
  summary: 'Show file metadata such as size, type, and modified time.',
  usage: 'stat <path>',
  details: 'Examples:\n  stat /logs/app.log\n  stat notes/todo.txt',
  handler: cmdStat,
  acceptsStdin: false,
  minArgs: 1,
  maxArgs: 1,
  conformanceArgs: ['/missing'],
};

async function cmdCat(ctx: CommandContext, args: string[], stdin: Uint8Array) {
  if (stdin.length > 0) {
    return err(
      'cat: does not accept stdin in this implementation. Use pipe targets like grep/head/tail/write.',
    );
  }
  if (args.length !== 1) {
    return err('cat: usage: cat <path>');
  }

  const target = args[0]!;
  const normalized = ctx.vfs.normalize(target);

  try {
    const info = await ctx.vfs.stat(target);

    if (!info.exists) {
      return err(`cat: file not found: ${normalized}. Use: ls ${parentPath(target)}`);
    }
    if (info.isDir) {
      return err(`cat: path is a directory: ${normalized}. Use: ls ${normalized}`);
    }
    const limitError = materializedLimitError(ctx, 'cat', normalized, info.size);
    if (limitError !== undefined) {
      return limitError;
    }

    const raw = await ctx.vfs.readBytes(target);
    if (looksBinary(raw)) {
      return err(`cat: binary file (${formatSize(raw.length)}): ${normalized}. Use: stat ${normalized}`);
    }

    return okBytes(raw, 'text/plain');
  } catch (caught) {
    const escapeResult = escapePathResult('cat', caught, normalized);
    if (escapeResult !== null) {
      return escapeResult;
    }
    return err(`cat: ${errorMessage(caught)}`);
  }
}

export const cat: CommandSpec = {
  name: 'cat',
  summary: 'Read a text file. For directories use ls. For binary use stat.',
  usage: 'cat <path>',
  details: 'Examples:\n  cat /notes/todo.txt\n  cat logs/app.log',
  handler: cmdCat,
  acceptsStdin: false,
  minArgs: 1,
  maxArgs: 1,
  conformanceArgs: ['/missing'],
};

async function cmdWrite(ctx: CommandContext, args: string[], stdin: Uint8Array) {
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
    const limitMessage = resourceLimitMessage('write', caught);
    if (limitMessage) {
      return err(limitMessage);
    }
    const escapeResult = escapePathResult('write', caught, ctx.vfs.normalize(args[0]!));
    if (escapeResult !== null) {
      return escapeResult;
    }
    if (code === 'EISDIR') {
      const normalized = ctx.vfs.normalize(args[0]!);
      return err(`write: path is a directory: ${normalized}. Use: ls ${normalized}`);
    }
    if (code === 'ENOTDIR') {
      return err(`write: parent is not a directory: ${await blockingParentPath(ctx, args[0]!)}`);
    }
    if (code === 'EEXIST') {
      const blockingPath = await firstFileInPath(ctx, parentPath(args[0]!));
      if (blockingPath) {
        return err(`write: parent is not a directory: ${blockingPath}`);
      }
    }
    if (code === 'ENOENT') {
      const missingParent = errorPath(caught) || parentPath(args[0]!);
      return err(`write: parent path not found: ${missingParent}. Use: mkdir ${missingParent}`);
    }
    return err(`write: ${errorMessage(caught)}`);
  }
}

export const write: CommandSpec = {
  name: 'write',
  summary: 'Write a file from inline content or stdin.',
  usage: 'write <path> [content]',
  details:
    'Examples:\n  write /notes/todo.txt "line one"\n  search "refund issue" | write /reports/refund.txt',
  handler: cmdWrite,
  acceptsStdin: true,
  minArgs: 1,
  conformanceArgs: ['/t.txt', 'x'],
};

async function cmdAppend(ctx: CommandContext, args: string[], stdin: Uint8Array) {
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
    const limitMessage = resourceLimitMessage('append', caught);
    if (limitMessage) {
      return err(limitMessage);
    }
    const escapeResult = escapePathResult('append', caught, ctx.vfs.normalize(args[0]!));
    if (escapeResult !== null) {
      return escapeResult;
    }
    if (code === 'EISDIR') {
      const normalized = ctx.vfs.normalize(args[0]!);
      return err(`append: path is a directory: ${normalized}. Use: ls ${normalized}`);
    }
    if (code === 'ENOTDIR') {
      return err(`append: parent is not a directory: ${await blockingParentPath(ctx, args[0]!)}`);
    }
    if (code === 'EEXIST') {
      const blockingPath = await firstFileInPath(ctx, parentPath(args[0]!));
      if (blockingPath) {
        return err(`append: parent is not a directory: ${blockingPath}`);
      }
    }
    if (code === 'ENOENT') {
      const missingParent = errorPath(caught) || parentPath(args[0]!);
      return err(`append: parent path not found: ${missingParent}. Use: mkdir ${missingParent}`);
    }
    return err(`append: ${errorMessage(caught)}`);
  }
}

export const append: CommandSpec = {
  name: 'append',
  summary: 'Append to a file from inline content or stdin.',
  usage: 'append <path> [content]',
  details: 'Examples:\n  append /notes/todo.txt "next item"\n  cat /tmp/out.txt | append /notes/archive.txt',
  handler: cmdAppend,
  acceptsStdin: true,
  minArgs: 1,
  conformanceArgs: ['/t.txt', 'x'],
};

async function cmdMkdir(ctx: CommandContext, args: string[], stdin: Uint8Array) {
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
    const limitMessage = resourceLimitMessage('mkdir', caught);
    if (limitMessage) {
      return err(limitMessage);
    }
    const escapeResult = escapePathResult('mkdir', caught, ctx.vfs.normalize(args[0]!));
    if (escapeResult !== null) {
      return escapeResult;
    }
    if (code === 'EEXIST') {
      return err(`mkdir: path already exists: ${ctx.vfs.normalize(args[0]!)}`);
    }
    if (code === 'ENOTDIR') {
      return err(`mkdir: parent is not a directory: ${await blockingParentPath(ctx, args[0]!)}`);
    }
    if (code === 'ENOENT') {
      return err(`mkdir: parent path not found: ${errorPath(caught)}`);
    }
    return err(`mkdir: ${errorMessage(caught)}`);
  }
}

export const mkdir: CommandSpec = {
  name: 'mkdir',
  summary: 'Create a directory and any missing parents.',
  usage: 'mkdir <path>',
  details: 'Examples:\n  mkdir /reports\n  mkdir notes/archive/2026',
  handler: cmdMkdir,
  acceptsStdin: false,
  minArgs: 1,
  maxArgs: 1,
  conformanceArgs: ['/tmp'],
};

async function cmdCp(ctx: CommandContext, args: string[], stdin: Uint8Array) {
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
    const limitMessage = resourceLimitMessage('cp', caught);
    if (limitMessage) {
      return err(limitMessage);
    }
    const escapeResult = escapePathResult('cp', caught, ctx.vfs.normalize(args[1]!));
    if (escapeResult !== null) {
      return escapeResult;
    }
    if (code === 'ENOENT') {
      return err(`cp: source not found: ${ctx.vfs.normalize(args[0]!)}`);
    }
    if (code === 'EEXIST') {
      const blockingPath = await firstFileInPath(ctx, parentPath(args[1]!));
      if (blockingPath) {
        return err(`cp: parent is not a directory: ${blockingPath}`);
      }
      return err(`cp: destination already exists: ${ctx.vfs.normalize(args[1]!)}`);
    }
    if (code === 'EISDIR') {
      const normalized = ctx.vfs.normalize(args[1]!);
      return err(`cp: destination is a directory: ${normalized}. Use a file path.`);
    }
    if (code === 'ENOTDIR') {
      return err(`cp: parent is not a directory: ${await blockingParentPath(ctx, args[1]!)}`);
    }
    if (code === 'EINVAL') {
      return err(`cp: destination is inside the source directory: ${ctx.vfs.normalize(args[1]!)}`);
    }
    return err(`cp: ${errorMessage(caught)}`);
  }
}

export const cp: CommandSpec = {
  name: 'cp',
  summary: 'Copy a file or directory inside the rooted virtual file system.',
  usage: 'cp <src> <dst>',
  details: 'Examples:\n  cp /drafts/qbr.md /reports/qbr-v1.md',
  handler: cmdCp,
  acceptsStdin: false,
  minArgs: 2,
  maxArgs: 2,
  conformanceArgs: ['/a', '/b'],
};

async function cmdMv(ctx: CommandContext, args: string[], stdin: Uint8Array) {
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
    const limitMessage = resourceLimitMessage('mv', caught);
    if (limitMessage) {
      return err(limitMessage);
    }
    const escapeResult = escapePathResult('mv', caught, ctx.vfs.normalize(args[1]!));
    if (escapeResult !== null) {
      return escapeResult;
    }
    if (code === 'ENOENT') {
      return err(`mv: source not found: ${ctx.vfs.normalize(args[0]!)}`);
    }
    if (code === 'EEXIST') {
      const blockingPath = await firstFileInPath(ctx, parentPath(args[1]!));
      if (blockingPath) {
        return err(`mv: parent is not a directory: ${blockingPath}`);
      }
      return err(`mv: destination already exists: ${ctx.vfs.normalize(args[1]!)}`);
    }
    if (code === 'EISDIR') {
      const normalized = ctx.vfs.normalize(args[1]!);
      return err(`mv: destination is a directory: ${normalized}. Use a file path.`);
    }
    if (code === 'ENOTDIR') {
      return err(`mv: parent is not a directory: ${await blockingParentPath(ctx, args[1]!)}`);
    }
    if (code === 'EINVAL') {
      return err(`mv: destination is inside the source directory: ${ctx.vfs.normalize(args[1]!)}`);
    }
    return err(`mv: ${errorMessage(caught)}`);
  }
}

export const mv: CommandSpec = {
  name: 'mv',
  summary: 'Move or rename a file or directory.',
  usage: 'mv <src> <dst>',
  details: 'Examples:\n  mv /drafts/qbr.md /archive/qbr.md',
  handler: cmdMv,
  acceptsStdin: false,
  minArgs: 2,
  maxArgs: 2,
  conformanceArgs: ['/a', '/b'],
};

async function cmdRm(ctx: CommandContext, args: string[], stdin: Uint8Array) {
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
    const code = errorCode(caught);
    if (code === 'ENOENT') {
      return err(`rm: path not found: ${ctx.vfs.normalize(args[0]!)}`);
    }
    const escapeResult = escapePathResult('rm', caught, ctx.vfs.normalize(args[0]!));
    if (escapeResult !== null) {
      return escapeResult;
    }
    if (code === 'EROOT') {
      return err('rm: cannot delete root: /');
    }
    return err(`rm: ${errorMessage(caught)}`);
  }
}

export const rm: CommandSpec = {
  name: 'rm',
  summary: 'Delete a file or directory recursively.',
  usage: 'rm <path>',
  details: 'Examples:\n  rm /tmp/out.txt\n  rm /scratch',
  handler: cmdRm,
  acceptsStdin: false,
  minArgs: 1,
  maxArgs: 1,
  conformanceArgs: ['/missing'],
};

async function cmdFind(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return err('find: does not accept stdin');
  }

  const parsed = parseFindArgs(args);
  if (!parsed.ok) {
    return err(parsed.error);
  }

  const { maxDepth, namePattern, targetPath, typeFilter } = parsed.value;
  const startPath = targetPath ?? '/';
  const normalizedStart = ctx.vfs.normalize(startPath);
  const namePatternRegex = namePattern === undefined ? undefined : compileWildcardPattern(namePattern);

  try {
    const startInfo = await ctx.vfs.stat(startPath);

    if (!startInfo.exists) {
      return err(`find: path not found: ${normalizedStart}`);
    }

    const matches: string[] = [];
    await collectFindMatches(
      ctx,
      normalizedStart,
      startInfo.isDir,
      0,
      { maxDepth, typeFilter, namePatternRegex },
      matches,
    );

    return ok(matches.join('\n'));
  } catch (caught) {
    const escapeResult = escapePathResult('find', caught, normalizedStart);
    if (escapeResult !== null) {
      return escapeResult;
    }
    return err(`find: ${errorMessage(caught)}`);
  }
}

export const find: CommandSpec = {
  name: 'find',
  summary: 'Recursively list files and directories with optional filters.',
  usage: FIND_USAGE,
  details: 'Examples:\n  find /logs\n  find /config -type f -name "*.json"\n  find /drafts --max-depth 1',
  handler: cmdFind,
  acceptsStdin: false,
  minArgs: 0,
  conformanceArgs: ['/'],
};

async function cmdDiff(ctx: CommandContext, args: string[], stdin: Uint8Array) {
  const parsed = parseDiffArgs(args);
  if (!parsed.ok) {
    return err(`diff: ${parsed.error}`, { exitCode: 2 });
  }

  return runDiffCommand(ctx, parsed.value, stdin);
}

export const diff: CommandSpec = {
  name: 'diff',
  summary: 'Compare files or directories with normal, unified, or context output.',
  usage: 'diff [-u|-U N|-c|-C N] [-r] [-a] [-b] [-i] <left> <right>',
  details:
    'Examples:\n  diff /drafts/a.txt /reports/a.txt\n  diff -u /drafts/a.txt /reports/a.txt\n  diff -r /left /right',
  handler: cmdDiff,
  acceptsStdin: true,
  minArgs: 2,
  conformanceArgs: ['/', '/'],
};

interface FindFilters {
  maxDepth: number;
  namePatternRegex: RegExp | undefined;
  typeFilter: 'file' | 'dir' | undefined;
}

async function collectFindMatches(
  ctx: CommandContext,
  currentPath: string,
  isDir: boolean,
  depth: number,
  filters: FindFilters,
  matches: string[],
): Promise<void> {
  if (matchesFindFilters(currentPath, isDir, filters)) {
    matches.push(currentPath);
  }

  if (!isDir || depth >= filters.maxDepth) {
    return;
  }

  const entries = [...(await ctx.vfs.listdir(currentPath))].sort(comparePathEntries);

  for (const entry of entries) {
    const childName = entry.endsWith('/') ? entry.slice(0, -1) : entry;
    const childPath = currentPath === '/' ? `/${childName}` : `${currentPath}/${childName}`;
    const childInfo = await ctx.vfs.stat(childPath);
    await collectFindMatches(ctx, childInfo.path, childInfo.isDir, depth + 1, filters, matches);
  }
}

function matchesFindFilters(path: string, isDir: boolean, filters: FindFilters): boolean {
  if (filters.typeFilter === 'file' && isDir) {
    return false;
  }
  if (filters.typeFilter === 'dir' && !isDir) {
    return false;
  }
  if (filters.namePatternRegex !== undefined && !filters.namePatternRegex.test(baseName(path))) {
    return false;
  }
  return true;
}

function compileWildcardPattern(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
}

function parseLsArgs(args: string[]): { ok: true; value: LsOptions } | { ok: false; error: string } {
  const options: LsOptions = {
    all: false,
    long: false,
    recursive: false,
    targetPath: '/',
  };
  let pathAssigned = false;
  let parsingOptions = true;

  for (const arg of args) {
    if (parsingOptions && arg === '--') {
      parsingOptions = false;
      continue;
    }

    if (parsingOptions && arg.startsWith('-') && arg !== '-') {
      for (let index = 1; index < arg.length; index += 1) {
        const flag = arg[index]!;
        switch (flag) {
          case '1':
            break;
          case 'a':
            options.all = true;
            break;
          case 'l':
            options.long = true;
            break;
          case 'R':
            options.recursive = true;
            break;
          default:
            return { ok: false, error: `ls: unknown option: -${flag}. Usage: ${LS_USAGE}` };
        }
      }
      continue;
    }

    if (pathAssigned) {
      return { ok: false, error: `ls: usage: ${LS_USAGE}` };
    }
    options.targetPath = arg;
    pathAssigned = true;
  }

  return { ok: true, value: options };
}

async function collectLsSections(
  ctx: CommandContext,
  directoryPath: string,
  options: LsOptions,
): Promise<Array<{ path: string; entries: LsEntry[] }>> {
  const sections: Array<{ path: string; entries: LsEntry[] }> = [];
  await collectLsSectionRecursive(ctx, directoryPath, options, sections);
  return sections;
}

async function collectLsSectionRecursive(
  ctx: CommandContext,
  directoryPath: string,
  options: LsOptions,
  sections: Array<{ path: string; entries: LsEntry[] }>,
): Promise<void> {
  const entries = await listLsEntries(ctx, directoryPath, options);
  sections.push({ path: directoryPath, entries });

  for (const entry of entries) {
    if (entry.isSynthetic || !entry.info.isDir) {
      continue;
    }

    const childPath =
      directoryPath === '/' ? `/${entry.displayName}` : `${directoryPath}/${entry.displayName}`;
    await collectLsSectionRecursive(ctx, childPath, options, sections);
  }
}

async function listLsEntries(
  ctx: CommandContext,
  directoryPath: string,
  options: LsOptions,
): Promise<LsEntry[]> {
  const rawEntries = await ctx.vfs.listdir(directoryPath);
  const entries: LsEntry[] = [];

  if (options.all) {
    const currentInfo = await ctx.vfs.stat(directoryPath);
    const parentInfo = await ctx.vfs.stat(parentPath(directoryPath));
    entries.push(createLsEntry('.', currentInfo, true));
    entries.push(createLsEntry('..', parentInfo, true));
  }

  for (const rawEntry of rawEntries) {
    const entryName = rawEntry.endsWith('/') ? rawEntry.slice(0, -1) : rawEntry;
    if (!options.all && entryName.startsWith('.')) {
      continue;
    }
    const entryPath = directoryPath === '/' ? `/${entryName}` : `${directoryPath}/${entryName}`;
    const info = await ctx.vfs.stat(entryPath);
    entries.push(createLsEntry(entryName, info));
  }

  entries.sort(compareLsEntries);
  return entries;
}

function createLsEntry(displayName: string, info: VFileInfo, isSynthetic = false): LsEntry {
  return {
    displayName,
    isSynthetic,
    info,
  };
}

function compareLsEntries(left: LsEntry, right: LsEntry): number {
  const leftRank = lsSpecialEntryRank(left.displayName);
  const rightRank = lsSpecialEntryRank(right.displayName);

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  return left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' });
}

function comparePathEntries(left: string, right: string): number {
  const leftName = left.endsWith('/') ? left.slice(0, -1) : left;
  const rightName = right.endsWith('/') ? right.slice(0, -1) : right;
  return leftName.localeCompare(rightName, undefined, { sensitivity: 'base' });
}

function lsSpecialEntryRank(displayName: string): number {
  switch (displayName) {
    case '.':
      return -2;
    case '..':
      return -1;
    default:
      return 0;
  }
}

function renderLsOutput(entries: LsEntry[], options: LsOptions): string {
  return entries
    .map(function (entry) {
      return renderLsEntry(entry, options);
    })
    .join('\n');
}

function renderRecursiveLsOutput(
  sections: Array<{ path: string; entries: LsEntry[] }>,
  options: LsOptions,
): string {
  return sections
    .map(function (section) {
      const body = renderLsOutput(section.entries, options);
      return body === '' ? `${section.path}:` : `${section.path}:\n${body}`;
    })
    .join('\n\n');
}

function renderLsEntry(entry: LsEntry, options: LsOptions): string {
  if (!options.long) {
    return entry.displayName;
  }

  return [
    entry.info.isDir ? 'd' : '-',
    String(entry.info.size).padStart(8, ' '),
    formatLsTimestamp(entry.info.modifiedEpochMs),
    entry.displayName,
  ].join(' ');
}

function formatLsTimestamp(modifiedEpochMs: number): string {
  return new Date(modifiedEpochMs).toISOString();
}

function parseFindArgs(args: string[]):
  | {
      ok: true;
      value: {
        targetPath: string | undefined;
        typeFilter: 'file' | 'dir' | undefined;
        namePattern: string | undefined;
        maxDepth: number;
      };
    }
  | {
      ok: false;
      error: string;
    } {
  let targetPath: string | undefined;
  let typeFilter: 'file' | 'dir' | undefined;
  let namePattern: string | undefined;
  let maxDepth = Number.POSITIVE_INFINITY;
  let parsingOptions = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (parsingOptions && arg === '--') {
      parsingOptions = false;
      continue;
    }

    if (parsingOptions && isFindTypeFlag(arg)) {
      const value = readFindOptionValue(args, index);
      if (value === null) {
        return { ok: false, error: `find: missing value for ${arg}. Usage: ${FIND_USAGE}` };
      }
      const normalizedType = normalizeFindTypeValue(value);
      if (normalizedType === null) {
        return { ok: false, error: `find: invalid value for ${arg}: ${value}. Expected file, dir, f, or d.` };
      }
      typeFilter = normalizedType;
      index += 1;
      continue;
    }

    if (parsingOptions && isFindNameFlag(arg)) {
      const value = readFindOptionValue(args, index);
      if (value === null) {
        return { ok: false, error: `find: missing value for ${arg}. Usage: ${FIND_USAGE}` };
      }
      namePattern = value;
      index += 1;
      continue;
    }

    if (parsingOptions && isFindMaxDepthFlag(arg)) {
      const value = readFindOptionValue(args, index);
      if (value === null) {
        return { ok: false, error: `find: missing value for ${arg}. Usage: ${FIND_USAGE}` };
      }
      const parsedDepth = Number.parseInt(value, 10);
      if (!Number.isFinite(parsedDepth) || parsedDepth < 0) {
        return { ok: false, error: `find: invalid integer for ${arg}: ${value}` };
      }
      maxDepth = parsedDepth;
      index += 1;
      continue;
    }

    if (parsingOptions && arg.startsWith('-') && arg !== '-') {
      return { ok: false, error: `find: unknown option: ${arg}. Usage: ${FIND_USAGE}` };
    }

    if (targetPath !== undefined) {
      return { ok: false, error: `find: usage: ${FIND_USAGE}` };
    }

    targetPath = arg;
  }

  return {
    ok: true,
    value: {
      maxDepth,
      namePattern,
      targetPath,
      typeFilter,
    },
  };
}

function isFindTypeFlag(value: string): boolean {
  return value === '--type' || value === '-type';
}

function isFindNameFlag(value: string): boolean {
  return value === '--name' || value === '-name';
}

function isFindMaxDepthFlag(value: string): boolean {
  return value === '--max-depth' || value === '-maxdepth';
}

function normalizeFindTypeValue(value: string): 'file' | 'dir' | null {
  switch (value) {
    case 'file':
    case 'f':
      return 'file';
    case 'dir':
    case 'd':
      return 'dir';
    default:
      return null;
  }
}

function readFindOptionValue(args: string[], index: number): string | null {
  return args[index + 1] ?? null;
}

export const fsCommands: CommandSpec[] = [ls, stat, cat, write, append, mkdir, cp, diff, mv, rm, find];
