import { parseCommandLine, type ChainNode, type PipelineNode, ParseError } from './parser.js';
import {
  CommandRegistry,
  createCommandRegistry,
  type BuiltinCommandSelection,
  type CommandContext,
  type CommandSpec,
  type CreateCommandRegistryOptions,
} from './commands/index.js';
import { SimpleMemory } from './memory.js';
import type { CommandResult, ToolAdapters } from './types.js';
import { err, ok, textDecoder } from './types.js';
import { errorMessage, formatDuration, formatSize, looksBinary, splitLines } from './utils.js';
import type { VFS } from './vfs/interface.js';

export interface AgentCLIOptions {
  vfs: VFS;
  adapters?: ToolAdapters;
  memory?: SimpleMemory;
  registry?: CommandRegistry;
  builtinCommands?: BuiltinCommandSelection | false;
  commands?: Iterable<CommandSpec>;
  outputLimits?: AgentCLIOutputLimits;
}

export interface AgentCLIOutputLimits {
  maxLines?: number;
  maxBytes?: number;
}

export type ToolDescriptionVariant = 'full-tool-description' | 'minimal-tool-description' | 'terse';
export type PipelineSkippedReason = 'previous_failed' | 'previous_succeeded';
export type PresentationStdoutMode = 'plain' | 'truncated' | 'binary-guard';

export interface CommandExecutionTrace {
  argv: string[];
  stdinBytes: number;
  stdoutBytes: number;
  stderr: string;
  exitCode: number;
  durationMs: number;
  contentType: string;
}

export interface PipelineExecutionTrace {
  relationFromPrevious: '&&' | '||' | ';' | null;
  executed: boolean;
  skippedReason?: PipelineSkippedReason;
  commands: CommandExecutionTrace[];
  exitCode?: number;
}

export interface RunPresentation {
  text: string;
  body: string;
  stdoutMode: PresentationStdoutMode;
  savedPath?: string;
  totalBytes?: number;
  totalLines?: number;
}

export interface RunExecution {
  commandLine: string;
  exitCode: number;
  durationMs: number;
  stdout: Uint8Array;
  stderr: string;
  contentType: string;
  trace: PipelineExecutionTrace[];
  presentation: RunPresentation;
}

interface ChainExecutionResult {
  result: CommandResult;
  trace: PipelineExecutionTrace[];
}

interface PipelineExecutionResult {
  result: CommandResult;
  trace: PipelineExecutionTrace;
}

interface RenderedStdout {
  text: string;
  stdoutMode: PresentationStdoutMode;
  savedPath?: string;
  totalBytes?: number;
  totalLines?: number;
}

export class AgentCLI {
  public readonly registry: CommandRegistry;
  public readonly ctx: CommandContext;
  private readonly outputLimits: Required<AgentCLIOutputLimits>;

  constructor(options: AgentCLIOptions) {
    this.registry = resolveRegistry(options);
    this.outputLimits = resolveOutputLimits(options.outputLimits);
    this.ctx = {
      vfs: options.vfs,
      adapters: options.adapters ?? {},
      memory: options.memory ?? new SimpleMemory(),
      registry: this.registry,
      outputDir: '/.system/cmd-output',
      outputCounter: 0,
    };
  }

  async initialize(): Promise<void> {
    await this.ctx.vfs.mkdir(this.ctx.outputDir, true);
  }

  buildToolDescription(variant: ToolDescriptionVariant = 'full-tool-description'): string {
    const commands = this.registry.all();
    const hasHelp = this.registry.has('help');

    if (commands.length === 0) {
      return buildEmptyToolDescription();
    }

    switch (variant) {
      case 'minimal-tool-description':
        return buildMinimalToolDescription(commands, hasHelp);
      case 'terse':
        return buildTerseToolDescription(commands, hasHelp);
      case 'full-tool-description':
        return buildFullToolDescription(commands, hasHelp);
    }
  }

  async run(commandLine: string): Promise<string> {
    const execution = await this.runDetailed(commandLine);
    return execution.presentation.text;
  }

  async runDetailed(commandLine: string): Promise<RunExecution> {
    const started = performance.now();

    try {
      const chain = parseCommandLine(commandLine);
      const execution = await this.executeChain(chain);
      return this.finalizeRunExecution(commandLine, execution.result, execution.trace, started);
    } catch (caught) {
      if (caught instanceof ParseError) {
        return this.finalizeRunExecution(commandLine, err(caught.message, { exitCode: 2 }), [], started);
      }
      return this.finalizeRunExecution(
        commandLine,
        err(`internal runtime error: ${errorMessage(caught)}`, { exitCode: 1 }),
        [],
        started,
      );
    }
  }

  private async executeChain(chain: ChainNode[]): Promise<ChainExecutionResult> {
    const aggregate: number[] = [];
    let lastResult = ok('');
    const trace: PipelineExecutionTrace[] = [];

    for (const item of chain) {
      const skippedReason = getPipelineSkippedReason(item.relationFromPrevious, lastResult.exitCode);
      if (skippedReason !== null) {
        trace.push({
          relationFromPrevious: item.relationFromPrevious,
          executed: false,
          skippedReason,
          commands: [],
        });
        continue;
      }

      const pipelineResult = await this.executePipeline(item.pipeline, item.relationFromPrevious);
      trace.push(pipelineResult.trace);
      if (pipelineResult.result.stdout.length > 0) {
        if (
          aggregate.length > 0 &&
          aggregate[aggregate.length - 1] !== 10 &&
          pipelineResult.result.stdout[0] !== 10
        ) {
          aggregate.push(10);
        }
        aggregate.push(...pipelineResult.result.stdout);
      }
      lastResult = pipelineResult.result;
    }

    return {
      result: {
        stdout: new Uint8Array(aggregate),
        stderr: lastResult.stderr,
        exitCode: lastResult.exitCode,
        contentType: lastResult.contentType,
      },
      trace,
    };
  }

  private async executePipeline(
    pipeline: PipelineNode,
    relationFromPrevious: '&&' | '||' | ';' | null,
  ): Promise<PipelineExecutionResult> {
    let currentStdin = new Uint8Array();
    let last = ok('');
    const commandTrace: CommandExecutionTrace[] = [];

    for (const node of pipeline.commands) {
      if (node.argv.length === 0) {
        last = err('empty command in pipeline', { exitCode: 2 });
        commandTrace.push({
          argv: [],
          stdinBytes: currentStdin.length,
          stdoutBytes: 0,
          stderr: last.stderr,
          exitCode: last.exitCode,
          durationMs: 0,
          contentType: last.contentType,
        });
        break;
      }

      const started = performance.now();
      last = await this.dispatch(node.argv, currentStdin);
      commandTrace.push({
        argv: [...node.argv],
        stdinBytes: currentStdin.length,
        stdoutBytes: last.stdout.length,
        stderr: last.stderr,
        exitCode: last.exitCode,
        durationMs: Math.max(0, Math.round(performance.now() - started)),
        contentType: last.contentType,
      });

      if (last.exitCode !== 0) {
        break;
      }
      currentStdin = new Uint8Array(last.stdout);
    }

    return {
      result: last,
      trace: {
        relationFromPrevious,
        executed: true,
        commands: commandTrace,
        exitCode: last.exitCode,
      },
    };
  }

  private async dispatch(argv: string[], stdin: Uint8Array): Promise<CommandResult> {
    const spec = this.registry.get(argv[0]!);
    if (!spec) {
      const available = this.registry.names();
      return err(
        `unknown command: ${argv[0]!}\nAvailable: ${available.length > 0 ? available.join(', ') : '(none)'}`,
        {
          exitCode: 127,
        },
      );
    }
    return spec.handler(this.ctx, argv.slice(1), stdin);
  }

  private async finalizeRunExecution(
    commandLine: string,
    result: CommandResult,
    trace: PipelineExecutionTrace[],
    started: number,
  ): Promise<RunExecution> {
    const durationMs = Math.max(0, Math.round(performance.now() - started));
    const presentation = await this.present(result, durationMs);

    return {
      commandLine,
      exitCode: result.exitCode,
      durationMs,
      stdout: new Uint8Array(result.stdout),
      stderr: result.stderr,
      contentType: result.contentType,
      trace,
      presentation,
    };
  }

  private async present(result: CommandResult, durationMs: number): Promise<RunPresentation> {
    const parts: string[] = [];
    const presentation: RunPresentation = {
      text: '',
      body: '',
      stdoutMode: 'plain',
    };

    if (result.stdout.length > 0) {
      if (looksBinary(result.stdout)) {
        const saved = await this.storeOverflowBytes(result.stdout, '.bin');
        presentation.stdoutMode = 'binary-guard';
        presentation.savedPath = saved;
        presentation.totalBytes = result.stdout.length;
        parts.push(
          '[error] command produced binary output that should not be sent to the model.\n' +
            `Saved to: ${saved}\n` +
            `Use: stat ${saved}`,
        );
      } else {
        const renderedStdout = await this.applyOverflow(textDecoder.decode(result.stdout));
        presentation.stdoutMode = renderedStdout.stdoutMode;
        if (renderedStdout.savedPath !== undefined) {
          presentation.savedPath = renderedStdout.savedPath;
        }
        if (renderedStdout.totalBytes !== undefined) {
          presentation.totalBytes = renderedStdout.totalBytes;
        }
        if (renderedStdout.totalLines !== undefined) {
          presentation.totalLines = renderedStdout.totalLines;
        }
        if (renderedStdout.text.trim().length > 0) {
          parts.push(renderedStdout.text.trimEnd());
        }
      }
    }

    if (result.exitCode !== 0 && result.stderr.trim().length > 0) {
      parts.push(`[error] ${result.stderr.trim()}`);
    } else if (result.stderr.trim().length > 0) {
      parts.push(`[stderr] ${result.stderr.trim()}`);
    }

    presentation.body = parts.join('\n\n');
    const footer = `[exit:${result.exitCode} | ${formatDuration(durationMs)}]`;
    presentation.text = presentation.body.length > 0 ? `${presentation.body}\n\n${footer}` : footer;
    return presentation;
  }

  private async applyOverflow(text: string): Promise<RenderedStdout> {
    const { maxLines, maxBytes } = this.outputLimits;
    const encoder = new TextEncoder();
    const encoded = encoder.encode(text);
    const lines = splitLines(text);

    if (lines.length <= maxLines && encoded.length <= maxBytes) {
      return {
        text,
        stdoutMode: 'plain',
      };
    }

    const saved = await this.storeOverflowText(text);
    let preview = lines.slice(0, maxLines).join('\n');

    while (encoder.encode(preview).length > maxBytes && preview.length > 0) {
      preview = preview.slice(0, -1);
    }

    const meta =
      `--- output truncated (${lines.length} lines, ${formatSize(encoded.length)}) ---\n` +
      `Full output: ${saved}\n` +
      `Explore: cat ${saved} | grep <pattern>\n` +
      `         cat ${saved} | tail -n 100`;

    return {
      text: preview.length === 0 ? meta : `${preview}\n\n${meta}`,
      stdoutMode: 'truncated',
      savedPath: saved,
      totalBytes: encoded.length,
      totalLines: lines.length,
    };
  }

  private async storeOverflowText(text: string): Promise<string> {
    this.ctx.outputCounter += 1;
    const target = `${this.ctx.outputDir}/cmd-${String(this.ctx.outputCounter).padStart(4, '0')}.txt`;
    await this.ctx.vfs.writeBytes(target, new TextEncoder().encode(text));
    return target;
  }

  private async storeOverflowBytes(data: Uint8Array, suffix = '.bin'): Promise<string> {
    this.ctx.outputCounter += 1;
    const target = `${this.ctx.outputDir}/cmd-${String(this.ctx.outputCounter).padStart(4, '0')}${suffix}`;
    await this.ctx.vfs.writeBytes(target, data);
    return target;
  }
}

function buildFullToolDescription(commands: CommandSpec[], hasHelp: boolean): string {
  const lines = [...buildDescriptionHeader(), '', 'Available commands:'];

  for (const spec of commands) {
    lines.push(`  ${spec.name.padEnd(8, ' ')} — ${spec.summary}`);
  }

  lines.push('', ...buildDiscoveryLines(hasHelp));

  return lines.join('\n');
}

function buildMinimalToolDescription(commands: CommandSpec[], hasHelp: boolean): string {
  const lines = buildDescriptionHeader();

  lines.push('');
  lines.push('Command discovery:');
  if (hasHelp) {
    lines.push("  - run 'help' to list commands");
  } else {
    lines.push('  - available command names:');
    for (const spec of commands) {
      lines.push(`      ${spec.name}`);
    }
  }
  lines.push("  - run '<command>' with no args for usage");
  lines.push('  - use pipes for composition');
  if (hasHelp) {
    lines.push('  - detailed command catalog omitted in this variant');
  }

  return lines.join('\n');
}

function buildTerseToolDescription(commands: CommandSpec[], hasHelp: boolean): string {
  const lines = buildDescriptionHeader();

  lines.push('', 'Available commands:');
  for (const spec of commands) {
    lines.push(`  ${spec.name}`);
  }
  lines.push('', ...buildDiscoveryLines(hasHelp));

  return lines.join('\n');
}

function buildEmptyToolDescription(): string {
  const lines = buildDescriptionHeader();
  lines.push('', 'Available commands:');
  lines.push('  (no commands registered)');
  lines.push('', 'Register built-in or custom commands before exposing the run tool.');
  return lines.join('\n');
}

function buildDescriptionHeader(): string[] {
  return [
    'Run CLI-style commands over registered tools and a rooted virtual file system.',
    'This is not a real shell. Only registered commands are allowed.',
    'Supported operators: |  &&  ||  ;',
    'No env expansion, no globbing, no command substitution, no redirection.',
    "Paths are rooted to '/'. Relative paths also resolve under '/'.",
  ];
}

function buildDiscoveryLines(hasHelp: boolean): string[] {
  const discovery = ['Discovery pattern:'];
  if (hasHelp) {
    discovery.push("  - run 'help' to list commands");
  }
  discovery.push("  - run '<command>' with no args for usage");
  discovery.push('  - use pipes for composition');
  return discovery;
}

function getPipelineSkippedReason(
  relation: '&&' | '||' | ';' | null,
  previousExitCode: number,
): PipelineSkippedReason | null {
  if (relation === '&&' && previousExitCode !== 0) {
    return 'previous_failed';
  }
  if (relation === '||' && previousExitCode === 0) {
    return 'previous_succeeded';
  }
  return null;
}

export async function createAgentCLI(options: AgentCLIOptions): Promise<AgentCLI> {
  const runtime = new AgentCLI(options);
  await runtime.initialize();
  return runtime;
}

function resolveRegistry(options: AgentCLIOptions): CommandRegistry {
  if (options.registry !== undefined) {
    if (options.builtinCommands !== undefined) {
      throw new Error('AgentCLIOptions.registry cannot be combined with builtinCommands');
    }
    if (options.commands !== undefined) {
      throw new Error('AgentCLIOptions.registry cannot be combined with commands');
    }
    return options.registry;
  }

  if (options.builtinCommands === false) {
    const registryOptions: CreateCommandRegistryOptions = {
      includeGroups: [],
      onConflict: 'replace',
    };
    if (options.commands !== undefined) {
      registryOptions.commands = options.commands;
    }
    return createCommandRegistry(registryOptions);
  }

  const registryOptions: CreateCommandRegistryOptions = {
    ...(options.builtinCommands ?? {}),
    onConflict: 'replace',
  };
  if (options.commands !== undefined) {
    registryOptions.commands = options.commands;
  }
  return createCommandRegistry(registryOptions);
}

function resolveOutputLimits(outputLimits: AgentCLIOutputLimits | undefined): Required<AgentCLIOutputLimits> {
  const maxLines = outputLimits?.maxLines ?? 200;
  const maxBytes = outputLimits?.maxBytes ?? 50 * 1024;

  assertNonNegativeInteger(maxLines, 'outputLimits.maxLines');
  assertNonNegativeInteger(maxBytes, 'outputLimits.maxBytes');

  return { maxLines, maxBytes };
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}
