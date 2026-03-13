import type { CommandContext, CommandRegistry, CommandSpec } from '../commands/index.js';
import type { CommandResult } from '../types.js';
import { textDecoder, textEncoder } from '../types.js';

export interface CommandConformanceOptions {
  registry: CommandRegistry;
  makeCtx: (overrides?: Partial<CommandContext>) => CommandContext;
  strictMetadata?: boolean;
  rejectionStdin?: Uint8Array;
}

export interface CommandConformanceCase {
  commandName: string;
  name: string;
  run: () => Promise<void>;
}

const NO_STDIN = new Uint8Array();

export function createCommandConformanceCases(options: CommandConformanceOptions): CommandConformanceCase[] {
  const registry = options.registry;
  const strictMetadata = options.strictMetadata === true;
  const cases: CommandConformanceCase[] = [];

  for (const spec of registry.all()) {
    const sampleArgs = sampleArgsFor(spec);

    cases.push(
      createCase(spec, 'has valid spec metadata', async function (): Promise<void> {
        assertSpecMetadata(spec, sampleArgs, strictMetadata);
      }),
    );

    cases.push(
      createCase(spec, 'representative call never throws', async function (): Promise<void> {
        await invokeSpec(options, spec, sampleArgs);
      }),
    );

    cases.push(
      createCase(spec, 'error output references command name', async function (): Promise<void> {
        const result = await invokeSpec(options, spec, []);
        if (result.exitCode !== 0) {
          assertIncludes(
            result.stderr,
            spec.name,
            `error output should reference "${spec.name}": got "${result.stderr}"`,
          );
        }
      }),
    );

    if (registry.has('help')) {
      cases.push(
        createCase(spec, 'help entry exists', async function (): Promise<void> {
          const result = await invokeHelp(options, spec.name);
          assertEqual(result.exitCode, 0, `help ${spec.name} should exit successfully`);
          assertIncludes(
            stdoutText(result),
            spec.summary,
            `help ${spec.name} should include the command summary`,
          );
        }),
      );
    }

    if (spec.acceptsStdin === false) {
      cases.push(
        createCase(spec, 'rejects stdin', async function (): Promise<void> {
          const stdin = options.rejectionStdin ?? textEncoder.encode('unwanted');
          const result = await invokeSpec(options, spec, sampleArgs, stdin);
          assertEqual(result.exitCode, 1, `${spec.name} should reject stdin`);
          assertMatch(
            result.stderr,
            /does not accept stdin/,
            `${spec.name} should explain the stdin rejection`,
          );
        }),
      );
    }

    if ((spec.minArgs ?? 0) > 0) {
      cases.push(
        createCase(spec, `requires at least ${spec.minArgs} arg(s)`, async function (): Promise<void> {
          const result = await invokeSpec(options, spec, tooFewArgsFor(spec));
          assertCondition(result.exitCode !== 0, `${spec.name} should reject too few arguments`);
        }),
      );
    }

    if (spec.maxArgs !== undefined) {
      cases.push(
        createCase(spec, `rejects more than ${spec.maxArgs} arg(s)`, async function (): Promise<void> {
          const result = await invokeSpec(options, spec, tooManyArgsFor(spec));
          assertCondition(result.exitCode !== 0, `${spec.name} should reject too many arguments`);
        }),
      );
    }

    if (spec.requiresAdapter !== undefined) {
      cases.push(
        createCase(
          spec,
          `reports missing ${String(spec.requiresAdapter)} adapter`,
          async function (): Promise<void> {
            const result = await invokeSpec(options, spec, adapterArgsFor(spec, sampleArgs), NO_STDIN, {
              adapters: {},
            });
            assertEqual(result.exitCode, 1, `${spec.name} should reject missing adapters`);
            assertMatch(
              result.stderr,
              new RegExp(
                `${escapeRegExp(spec.name)}: no ${escapeRegExp(String(spec.requiresAdapter))} adapter configured`,
              ),
              `${spec.name} should explain the missing adapter`,
            );
          },
        ),
      );
    }
  }

  return cases;
}

function createCase(spec: CommandSpec, name: string, run: () => Promise<void>): CommandConformanceCase {
  return {
    commandName: spec.name,
    name,
    run,
  };
}

function sampleArgsFor(spec: CommandSpec): string[] {
  return [...(spec.conformanceArgs ?? [])];
}

function adapterArgsFor(spec: CommandSpec, sampleArgs: string[]): string[] {
  if (sampleArgs.length > 0) {
    return [...sampleArgs];
  }

  const count = Math.max(spec.minArgs ?? 0, 1);
  return Array.from({ length: count }, function (_, index) {
    return `arg${index}`;
  });
}

function tooFewArgsFor(spec: CommandSpec): string[] {
  const minArgs = spec.minArgs ?? 0;
  return Array.from({ length: minArgs - 1 }, function (_, index) {
    return `arg${index}`;
  });
}

function tooManyArgsFor(spec: CommandSpec): string[] {
  const maxArgs = spec.maxArgs ?? 0;
  return Array.from({ length: maxArgs + 1 }, function (_, index) {
    return `arg${index}`;
  });
}

function assertSpecMetadata(spec: CommandSpec, sampleArgs: string[], strictMetadata: boolean): void {
  assertNonEmpty(spec.name, 'command name');
  assertNonEmpty(spec.summary, `${spec.name} summary`);
  assertNonEmpty(spec.usage, `${spec.name} usage`);
  assertNonEmpty(spec.details, `${spec.name} details`);
  assertCondition(typeof spec.handler === 'function', `${spec.name} handler must be a function`);

  if (strictMetadata) {
    assertCondition(typeof spec.acceptsStdin === 'boolean', `${spec.name} should declare acceptsStdin`);
    assertCondition(typeof spec.minArgs === 'number', `${spec.name} should declare minArgs`);
    assertCondition(Array.isArray(spec.conformanceArgs), `${spec.name} should declare conformanceArgs`);
  } else {
    if (spec.acceptsStdin !== undefined) {
      assertCondition(typeof spec.acceptsStdin === 'boolean', `${spec.name} acceptsStdin must be boolean`);
    }
    if (spec.minArgs !== undefined) {
      assertCondition(typeof spec.minArgs === 'number', `${spec.name} minArgs must be numeric`);
    }
    if (spec.conformanceArgs !== undefined) {
      assertCondition(Array.isArray(spec.conformanceArgs), `${spec.name} conformanceArgs must be an array`);
    }
  }

  if (spec.maxArgs !== undefined) {
    assertCondition(typeof spec.maxArgs === 'number', `${spec.name} maxArgs must be numeric`);
    assertCondition(spec.maxArgs >= (spec.minArgs ?? 0), `${spec.name} has maxArgs < minArgs`);
  }
  if (spec.minArgs !== undefined) {
    assertCondition(sampleArgs.length >= spec.minArgs, `${spec.name} conformanceArgs should satisfy minArgs`);
  }
  if (spec.maxArgs !== undefined) {
    assertCondition(sampleArgs.length <= spec.maxArgs, `${spec.name} conformanceArgs should satisfy maxArgs`);
  }
}

async function invokeHelp(options: CommandConformanceOptions, commandName: string): Promise<CommandResult> {
  const ctx = options.makeCtx({ registry: options.registry });
  const help = ctx.registry.get('help');
  if (!help) {
    throw new Error('help command is not registered');
  }
  return help.handler(ctx, [commandName], NO_STDIN);
}

async function invokeSpec(
  options: CommandConformanceOptions,
  spec: CommandSpec,
  args: string[],
  stdin: Uint8Array = NO_STDIN,
  ctxOverrides: Partial<CommandContext> = {},
): Promise<CommandResult> {
  const ctx = options.makeCtx({ registry: options.registry, ...ctxOverrides });
  return spec.handler(ctx, [...args], stdin);
}

function stdoutText(result: CommandResult): string {
  return textDecoder.decode(result.stdout);
}

function assertCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}. Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertIncludes(actual: string, expected: string, message: string): void {
  if (!actual.includes(expected)) {
    throw new Error(`${message}. Expected "${actual}" to include "${expected}"`);
  }
}

function assertMatch(actual: string, pattern: RegExp, message: string): void {
  if (!pattern.test(actual)) {
    throw new Error(`${message}. Expected "${actual}" to match ${pattern}`);
  }
}

function assertNonEmpty(value: string, label: string): void {
  assertCondition(value.trim().length > 0, `${label} must be non-empty`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
