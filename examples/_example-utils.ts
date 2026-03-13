import process from 'node:process';
import { pathToFileURL } from 'node:url';

import type { RunExecution } from '@onetool/one-tool';

export interface ExampleOptions {
  quiet?: boolean;
  args?: string[];
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
}

export interface ExampleIO {
  write(text: string): void;
  error(text: string): void;
}

export function createExampleIO(options: ExampleOptions = {}): ExampleIO {
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

export function getExampleArgs(options: ExampleOptions = {}): string[] {
  return options.args ?? process.argv.slice(2);
}

export function formatExampleError(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
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
    const status = pipeline.executed
      ? `exit=${pipeline.exitCode ?? 'n/a'}`
      : `skipped=${pipeline.skippedReason}`;
    lines.push(`pipeline[${pipelineIndex}] (${relation}) ${status}`);

    for (const [commandIndex, command] of pipeline.commands.entries()) {
      lines.push(
        `  command[${commandIndex}] ${command.argv.join(' ')} (stdin=${command.stdinBytes}B stdout=${command.stdoutBytes}B exit=${command.exitCode})`,
      );
    }
  }

  return lines.join('\n');
}

function isDirectEntrypoint(metaUrl: string): boolean {
  const entryPath = process.argv[1];
  if (!entryPath) {
    return false;
  }
  return pathToFileURL(entryPath).href === metaUrl;
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
