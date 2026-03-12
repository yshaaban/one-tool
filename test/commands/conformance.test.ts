import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { CommandSpec } from '../../src/commands/index.js';
import type { CommandResult } from '../../src/types.js';
import { NO_STDIN, makeCtx, makeRegistry, runCommand, stdinText, stdoutText } from './harness.js';

const registry = makeRegistry();

function sampleArgsFor(spec: CommandSpec): string[] {
  return [...(spec.conformanceArgs ?? [])];
}

function tooFewArgsFor(spec: CommandSpec): string[] {
  const minArgs = spec.minArgs ?? 0;
  return Array.from({ length: minArgs - 1 }, (_, index) => `arg${index}`);
}

function tooManyArgsFor(spec: CommandSpec): string[] {
  const maxArgs = spec.maxArgs ?? 0;
  return Array.from({ length: maxArgs + 1 }, (_, index) => `arg${index}`);
}

function assertSpecMetadata(spec: CommandSpec, sampleArgs: string[]): void {
  assert.ok(spec.name.length > 0);
  assert.ok(spec.summary.length > 0);
  assert.ok(spec.usage.length > 0);
  assert.ok(spec.details.length > 0);
  assert.equal(typeof spec.handler, 'function');

  assert.equal(typeof spec.acceptsStdin, 'boolean');
  assert.equal(typeof spec.minArgs, 'number');
  assert.ok(Array.isArray(spec.conformanceArgs), `${spec.name} should declare conformanceArgs`);

  if (spec.maxArgs !== undefined) {
    assert.ok(spec.maxArgs >= (spec.minArgs ?? 0), `${spec.name} has maxArgs < minArgs`);
  }
  if (spec.minArgs !== undefined) {
    assert.ok(
      sampleArgs.length >= spec.minArgs,
      `${spec.name} conformanceArgs should satisfy minArgs`,
    );
  }
  if (spec.maxArgs !== undefined) {
    assert.ok(
      sampleArgs.length <= spec.maxArgs,
      `${spec.name} conformanceArgs should satisfy maxArgs`,
    );
  }
}

async function invokeSpec(
  spec: CommandSpec,
  args: string[],
  stdin: Uint8Array = NO_STDIN,
): Promise<CommandResult> {
  const ctx = makeCtx();
  return spec.handler(ctx, [...args], stdin);
}

for (const spec of registry.all()) {
  const sampleArgs = sampleArgsFor(spec);

  describe(`conformance: ${spec.name}`, () => {
    test('has valid spec metadata', () => {
      assertSpecMetadata(spec, sampleArgs);
    });

    test('representative call never throws', async () => {
      await assert.doesNotReject(async () => invokeSpec(spec, sampleArgs));
    });

    test('error output references command name', async () => {
      const result = await invokeSpec(spec, []);
      if (result.exitCode !== 0) {
        assert.ok(
          result.stderr.includes(spec.name),
          `error output should reference "${spec.name}": got "${result.stderr}"`,
        );
      }
    });

    test('help entry exists', async () => {
      const { result } = await runCommand('help', [spec.name]);
      assert.equal(result.exitCode, 0);
      assert.ok(stdoutText(result).includes(spec.summary));
    });

    if (spec.acceptsStdin === false) {
      test('rejects stdin', async () => {
        const result = await invokeSpec(spec, sampleArgs, stdinText('unwanted'));
        assert.equal(result.exitCode, 1);
        assert.match(result.stderr, /does not accept stdin/);
      });
    }

    if ((spec.minArgs ?? 0) > 0) {
      test(`requires at least ${spec.minArgs} arg(s)`, async () => {
        const result = await invokeSpec(spec, tooFewArgsFor(spec));
        assert.equal(result.exitCode, 1);
      });
    }

    if (spec.maxArgs !== undefined) {
      test(`rejects more than ${spec.maxArgs} arg(s)`, async () => {
        const result = await invokeSpec(spec, tooManyArgsFor(spec));
        assert.equal(result.exitCode, 1);
      });
    }

    if (spec.requiresAdapter) {
      test(`reports missing ${spec.requiresAdapter} adapter`, async () => {
        const ctx = makeCtx({ adapters: {} });
        const result = await spec.handler(ctx, sampleArgsFor(spec), NO_STDIN);
        assert.equal(result.exitCode, 1);
        assert.match(
          result.stderr,
          new RegExp(`${spec.name}: no ${String(spec.requiresAdapter)} adapter configured`),
        );
      });
    }
  });
}
