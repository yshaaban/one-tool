import { parseCommandLine, type ChainNode, type PipelineNode, ParseError } from './parser.js';
import { CommandRegistry, registerBuiltinCommands, type CommandContext } from './commands.js';
import { SimpleMemory } from './memory.js';
import type { CommandResult, ToolAdapters } from './types.js';
import { err, ok } from './types.js';
import { formatDuration, formatSize, looksBinary, decodeText, splitLines } from './utils.js';
import { RootedVFS } from './vfs.js';

export interface AgentCLIOptions {
  vfs: RootedVFS;
  adapters?: ToolAdapters;
  memory?: SimpleMemory;
}

export class AgentCLI {
  public readonly registry: CommandRegistry;
  public readonly ctx: CommandContext;

  constructor(options: AgentCLIOptions) {
    this.registry = new CommandRegistry();
    this.ctx = {
      vfs: options.vfs,
      adapters: options.adapters ?? {},
      memory: options.memory ?? new SimpleMemory(),
      registry: this.registry,
      outputDir: '/.system/cmd-output',
      outputCounter: 0,
    };
    registerBuiltinCommands(this.registry);
  }

  async initialize(): Promise<void> {
    await this.ctx.vfs.mkdir(this.ctx.outputDir, true);
  }

  buildToolDescription(): string {
    const lines = [
      'Run CLI-style commands over registered tools and a rooted virtual file system.',
      'This is not a real shell. Only registered commands are allowed.',
      'Supported operators: |  &&  ||  ;',
      'No env expansion, no globbing, no command substitution, no redirection.',
      "Paths are rooted to '/'. Relative paths also resolve under '/'.",
      '',
      'Available commands:',
    ];

    for (const spec of this.registry.all()) {
      lines.push(`  ${spec.name.padEnd(8, ' ')} — ${spec.summary}`);
    }

    lines.push(
      '',
      'Discovery pattern:',
      "  - run 'help' to list commands",
      "  - run '<command>' with no args for usage",
      '  - use pipes for composition',
    );

    return lines.join('\n');
  }

  async run(commandLine: string): Promise<string> {
    const started = performance.now();

    try {
      const chain = parseCommandLine(commandLine);
      const result = await this.executeChain(chain);
      const durationMs = Math.max(0, Math.round(performance.now() - started));
      return this.present(result, durationMs);
    } catch (caught) {
      const durationMs = Math.max(0, Math.round(performance.now() - started));
      if (caught instanceof ParseError) {
        return this.present(err(caught.message, { exitCode: 2 }), durationMs);
      }
      const message = caught instanceof Error ? caught.message : String(caught);
      return this.present(err(`internal runtime error: ${message}`, { exitCode: 1 }), durationMs);
    }
  }

  private async executeChain(chain: ChainNode[]): Promise<CommandResult> {
    const aggregate: number[] = [];
    let lastResult = ok('');

    for (const item of chain) {
      if (!this.shouldRun(item.relationFromPrevious, lastResult.exitCode)) {
        continue;
      }

      const pipelineResult = await this.executePipeline(item.pipeline);
      if (pipelineResult.stdout.length > 0) {
        if (
          aggregate.length > 0 &&
          aggregate[aggregate.length - 1] !== 10 &&
          pipelineResult.stdout[0] !== 10
        ) {
          aggregate.push(10);
        }
        aggregate.push(...pipelineResult.stdout);
      }
      lastResult = pipelineResult;
    }

    return {
      stdout: new Uint8Array(aggregate),
      stderr: lastResult.stderr,
      exitCode: lastResult.exitCode,
      contentType: lastResult.contentType,
    };
  }

  private shouldRun(relation: '&&' | '||' | ';' | null, previousExitCode: number): boolean {
    if (relation === null || relation === ';') {
      return true;
    }
    if (relation === '&&') {
      return previousExitCode === 0;
    }
    if (relation === '||') {
      return previousExitCode !== 0;
    }
    return true;
  }

  private async executePipeline(pipeline: PipelineNode): Promise<CommandResult> {
    let currentStdin = new Uint8Array();
    let last = ok('');

    for (const node of pipeline.commands) {
      if (node.argv.length === 0) {
        return err('empty command in pipeline', { exitCode: 2 });
      }
      last = await this.dispatch(node.argv, currentStdin);
      if (last.exitCode !== 0) {
        return last;
      }
      currentStdin = new Uint8Array(last.stdout);
    }

    return last;
  }

  private async dispatch(argv: string[], stdin: Uint8Array): Promise<CommandResult> {
    const spec = this.registry.get(argv[0]!);
    if (!spec) {
      return err(`unknown command: ${argv[0]!}\nAvailable: ${this.registry.names().join(', ')}`, {
        exitCode: 127,
      });
    }
    return spec.handler(this.ctx, argv.slice(1), stdin);
  }

  private async present(result: CommandResult, durationMs: number): Promise<string> {
    const parts: string[] = [];

    if (result.stdout.length > 0) {
      if (looksBinary(result.stdout)) {
        const saved = await this.storeOverflowBytes(result.stdout, '.bin');
        parts.push(
          '[error] command produced binary output that should not be sent to the model.\n' +
            `Saved to: ${saved}\n` +
            `Use: stat ${saved}`,
        );
      } else {
        const stdoutText = await this.applyOverflow(decodeText(result.stdout));
        if (stdoutText.trim().length > 0) {
          parts.push(stdoutText.trimEnd());
        }
      }
    }

    if (result.exitCode !== 0 && result.stderr.trim().length > 0) {
      parts.push(`[error] ${result.stderr.trim()}`);
    } else if (result.stderr.trim().length > 0) {
      parts.push(`[stderr] ${result.stderr.trim()}`);
    }

    parts.push(`[exit:${result.exitCode} | ${formatDuration(durationMs)}]`);
    return parts.join('\n\n');
  }

  private async applyOverflow(text: string): Promise<string> {
    const maxLines = 200;
    const maxBytes = 50 * 1024;
    const encoded = new TextEncoder().encode(text);
    const lines = splitLines(text);

    if (lines.length <= maxLines && encoded.length <= maxBytes) {
      return text;
    }

    const saved = await this.storeOverflowText(text);
    let preview = lines.slice(0, maxLines).join('\n');

    while (new TextEncoder().encode(preview).length > maxBytes && preview.length > 0) {
      preview = preview.slice(0, -1);
    }

    const meta =
      `--- output truncated (${lines.length} lines, ${formatSize(encoded.length)}) ---\n` +
      `Full output: ${saved}\n` +
      `Explore: cat ${saved} | grep <pattern>\n` +
      `         cat ${saved} | tail -n 100`;

    return `${preview}\n\n${meta}`;
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

export async function createAgentCLI(options: AgentCLIOptions): Promise<AgentCLI> {
  const runtime = new AgentCLI(options);
  await runtime.initialize();
  return runtime;
}
