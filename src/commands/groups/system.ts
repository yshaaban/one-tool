import { err, ok, textDecoder } from '../../types.js';
import type { CommandContext, CommandSpec } from '../core.js';
import { renderHelp } from '../shared/io.js';

async function cmdHelp(ctx: CommandContext, args: string[], stdin: Uint8Array) {
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

export const help: CommandSpec = {
  name: 'help',
  summary: 'List commands or show detailed help for one command.',
  usage: 'help [command]',
  details: 'Examples:\n  help\n  help grep\n  grep',
  handler: cmdHelp,
  acceptsStdin: false,
  minArgs: 0,
  maxArgs: 1,
  conformanceArgs: [],
};

async function cmdMemory(ctx: CommandContext, args: string[], stdin: Uint8Array) {
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

export const memory: CommandSpec = {
  name: 'memory',
  summary: 'Search, store, or inspect lightweight working memory.',
  usage: 'memory search <query> | memory recent [N] | memory store <text>',
  details:
    'Examples:\n  memory store "Acme prefers Monday follow-ups"\n  memory search "Acme follow-up"\n  memory recent 5',
  handler: cmdMemory,
  acceptsStdin: true,
  minArgs: 1,
  conformanceArgs: ['recent'],
};

export const systemCommands: CommandSpec[] = [help, memory];
