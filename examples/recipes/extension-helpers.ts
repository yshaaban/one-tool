import { type CommandContext, type CommandResult, MemoryVFS, createAgentCLI, help, ok } from 'one-tool';
import {
  collectCommands,
  defineCommandGroup,
  formatVfsError,
  parseCountFlag,
  readJsonInput,
  readTextInput,
  stdinNotAcceptedError,
  usageError,
} from 'one-tool/extensions';

import {
  createExampleIO,
  printHeading,
  runIfEntrypoint,
  runCommandSequence,
  type ExampleRunOptions,
} from '../shared/example-utils.js';

async function cmdProfile(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  const action = args[0];
  if (action !== 'email') {
    return usageError('profile', 'profile email [path]');
  }

  const input = await readJsonInput<{ customer?: { email?: string } }>(ctx, 'profile', args[1], stdin);
  if (!input.ok) {
    return input.error;
  }

  return ok(input.value.customer?.email ?? '(no email)');
}

async function cmdShow(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return stdinNotAcceptedError('show');
  }
  if (args.length !== 1) {
    return usageError('show', 'show <path>');
  }

  try {
    return ok(await ctx.vfs.readText(args[0]!));
  } catch (caught) {
    return formatVfsError(ctx, 'show', args[0]!, caught, {
      notFoundLabel: 'file not found',
    });
  }
}

async function cmdTop(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  const parsed = parseCountFlag('top', args, 3);
  if (!parsed.ok) {
    return parsed.error;
  }

  const input = await readTextInput(ctx, 'top', parsed.value.rest[0], stdin);
  if (!input.ok) {
    return input.error;
  }

  const lines = input.value.split(/\r?\n/).filter(Boolean).slice(0, parsed.value.count);
  return ok(lines.join('\n'));
}

const helperCommands = defineCommandGroup('helper-recipes', [
  {
    name: 'profile',
    summary: 'Extract an email field from JSON on stdin or from a file.',
    usage: 'profile email [path]',
    details: 'Examples:\n  profile email /records/order.json\n  cat /records/order.json | profile email',
    handler: cmdProfile,
    minArgs: 1,
    maxArgs: 2,
    conformanceArgs: ['email'],
  },
  {
    name: 'show',
    summary: 'Read a file with agent-friendly VFS error translation.',
    usage: 'show <path>',
    details: 'Examples:\n  show /notes/todo.txt',
    handler: cmdShow,
    acceptsStdin: false,
    minArgs: 1,
    maxArgs: 1,
    conformanceArgs: ['/missing.txt'],
  },
  {
    name: 'top',
    summary: 'Show the first N lines from stdin or a file using parseCountFlag.',
    usage: 'top [-n count] [path]',
    details: 'Examples:\n  top -n 2 /notes/todo.txt\n  cat /notes/todo.txt | top -n 2',
    handler: cmdTop,
    minArgs: 0,
    conformanceArgs: [],
  },
]);

export async function main(options: ExampleRunOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const vfs = new MemoryVFS();

  await vfs.mkdir('/records', true);
  await vfs.mkdir('/notes', true);
  await vfs.writeBytes(
    '/records/order.json',
    encoder.encode(JSON.stringify({ customer: { email: 'ops@acme.example' } }, null, 2)),
  );
  await vfs.writeBytes('/notes/todo.txt', encoder.encode('triage alerts\nwrite summary\nnotify owner'));

  const runtime = await createAgentCLI({
    vfs,
    builtinCommands: false,
    commands: collectCommands([help, helperCommands]),
  });

  printHeading(
    io,
    'Recipe: extension helpers',
    'This command pack uses usageError, stdinNotAcceptedError, formatVfsError, readJsonInput, readTextInput, parseCountFlag, and defineCommandGroup.',
  );
  await runCommandSequence(io, runtime, [
    'help profile',
    'profile email /records/order.json',
    'show /missing.txt',
    'top -n 2 /notes/todo.txt',
  ]);
  io.write(
    `\nRaw bytes from todo.txt: ${decoder.decode((await vfs.readBytes('/notes/todo.txt')).slice(0, 10))}...`,
  );
}

await runIfEntrypoint(import.meta.url, main);
