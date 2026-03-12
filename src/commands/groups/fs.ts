import { err, ok, okBytes } from '../../types.js';
import { errorMessage, formatSize, looksBinary, parentPath } from '../../utils.js';
import type { CommandContext, CommandSpec } from '../core.js';
import { blockingParentPath, errorCode, errorPath, firstFileInPath } from '../shared/errors.js';
import { contentFromArgsOrStdin } from '../shared/io.js';

async function cmdLs(ctx: CommandContext, args: string[], stdin: Uint8Array) {
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

export const ls: CommandSpec = {
  name: 'ls',
  summary: 'List files or directories in the rooted virtual file system.',
  usage: 'ls [path]',
  details: 'Examples:\n  ls\n  ls /logs\n  ls notes',
  handler: cmdLs,
  acceptsStdin: false,
  minArgs: 0,
  maxArgs: 1,
  conformanceArgs: ['/'],
};

async function cmdStat(ctx: CommandContext, args: string[], stdin: Uint8Array) {
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

export const write: CommandSpec = {
  name: 'write',
  summary: 'Write a file from inline content or stdin.',
  usage: 'write <path> [content]',
  details: 'Examples:\n  write /notes/todo.txt "line one"\n  search "refund issue" | write /reports/refund.txt',
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

export const fsCommands: CommandSpec[] = [ls, stat, cat, write, append, mkdir, cp, mv, rm];
