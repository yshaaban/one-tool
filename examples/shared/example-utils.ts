import process from 'node:process';
import { pathToFileURL } from 'node:url';

import type { AgentCLI, RunExecution } from 'one-tool';

export interface ExampleRunOptions {
  quiet?: boolean;
  args?: string[];
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export interface ExampleIO {
  write(text: string): void;
  error(text: string): void;
}

export function createExampleIO(options: ExampleRunOptions = {}): ExampleIO {
  if (options.quiet) {
    return {
      write(): void {},
      error(): void {},
    };
  }

  return {
    write(text: string): void {
      (options.stdout ?? console.log)(text);
    },
    error(text: string): void {
      (options.stderr ?? console.error)(text);
    },
  };
}

export function getExampleArgs(options: ExampleRunOptions = {}): string[] {
  return options.args ?? process.argv.slice(2);
}

function isDirectEntrypoint(metaUrl: string): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }
  return pathToFileURL(entryPath).href === metaUrl;
}

export function formatExampleError(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

export async function runIfEntrypoint(metaUrl: string, main: () => Promise<void>): Promise<void> {
  if (!isDirectEntrypoint(metaUrl)) {
    return;
  }
  await main();
}

export async function runIfEntrypointWithErrorHandling(
  metaUrl: string,
  main: () => Promise<void>,
): Promise<void> {
  if (!isDirectEntrypoint(metaUrl)) {
    return;
  }

  try {
    await main();
  } catch (caught) {
    console.error(formatExampleError(caught));
    process.exit(1);
  }
}

export function printHeading(io: ExampleIO, title: string, summary?: string): void {
  io.write(title);
  io.write('-'.repeat(title.length));
  if (summary) {
    io.write(summary);
  }
}

export async function runCommandExample(io: ExampleIO, runtime: AgentCLI, command: string): Promise<void> {
  io.write(`\n$ ${command}`);
  io.write(await runtime.run(command));
}

export async function runCommandSequence(
  io: ExampleIO,
  runtime: AgentCLI,
  commands: readonly string[],
): Promise<void> {
  for (const command of commands) {
    await runCommandExample(io, runtime, command);
  }
}

export function formatExecutionSummary(execution: RunExecution): string {
  const lines = [
    `exitCode: ${execution.exitCode}`,
    `durationMs: ${execution.durationMs}`,
    `stdoutMode: ${execution.presentation.stdoutMode}`,
    `pipelines: ${execution.trace.length}`,
  ];

  for (const [pipelineIndex, pipeline] of execution.trace.entries()) {
    const relation = pipeline.relationFromPrevious ?? 'start';
    let status: string;
    if (pipeline.executed) {
      status = `exit=${pipeline.exitCode ?? 'n/a'}`;
    } else {
      status = `skipped=${pipeline.skippedReason}`;
    }
    lines.push(`pipeline[${pipelineIndex}] (${relation}) ${status}`);

    for (const [commandIndex, command] of pipeline.commands.entries()) {
      lines.push(
        `  command[${commandIndex}] ${command.argv.join(' ')} (stdin=${command.stdinBytes}B stdout=${command.stdoutBytes}B exit=${command.exitCode})`,
      );
    }
  }

  return lines.join('\n');
}
