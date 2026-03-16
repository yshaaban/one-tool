import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NO_STDIN,
  DemoFetch,
  DemoSearch,
  assertScenario,
  buildWorld,
  createCommandConformanceCases,
  createTestCommandContext,
  createTestCommandRegistry,
  runOracle,
  runRegisteredCommand,
  stdinText,
  stdoutText,
  type ScenarioSpec,
  type CommandSpec,
} from '../src/index.js';
import { ok } from '../src/types.js';

const echo: CommandSpec = {
  name: 'echo',
  summary: 'Echo text.',
  usage: 'echo <text...>',
  details: 'Examples:\n  echo hello',
  async handler(_ctx, args) {
    return ok(args.join(' '));
  },
};

test('createTestCommandRegistry supports the same selection API as runtime registries', function (): void {
  const registry = createTestCommandRegistry({
    preset: 'textOnly',
    commands: [echo],
    onConflict: 'replace',
  });

  assert.deepEqual(registry.names(), [
    'echo',
    'grep',
    'head',
    'help',
    'sed',
    'sort',
    'tail',
    'tr',
    'uniq',
    'wc',
  ]);
});

test('createTestCommandContext and runRegisteredCommand provide a stable public harness', async function (): Promise<void> {
  const registry = createTestCommandRegistry({
    includeGroups: ['system'],
    excludeCommands: ['memory'],
    commands: [echo],
  });
  const ctx = createTestCommandContext({ registry });
  const { result } = await runRegisteredCommand('echo', ['hello', 'world'], { ctx, stdin: NO_STDIN });

  assert.equal(result.exitCode, 0);
  assert.equal(stdoutText(result), 'hello world');
  assert.deepEqual(Array.from(stdinText('ok')), [111, 107]);
});

test('conformance helper works with the stable public testing harness', async function (): Promise<void> {
  const registry = createTestCommandRegistry({
    includeGroups: ['system'],
    excludeCommands: ['memory'],
    commands: [echo],
  });
  const cases = createCommandConformanceCases({
    registry,
    makeCtx: createTestCommandContext,
  }).filter(function (conformanceCase) {
    return conformanceCase.commandName === 'echo';
  });

  assert.ok(cases.length >= 3);
  for (const conformanceCase of cases) {
    await conformanceCase.run();
  }
});

test('runRegisteredCommand isolates callers from argument mutation', async function (): Promise<void> {
  const mutating: CommandSpec = {
    name: 'mutate',
    summary: 'Mutate args.',
    usage: 'mutate <value>',
    details: 'Examples:\n  mutate hello',
    async handler(_ctx, args) {
      args[0] = 'changed';
      return ok(args.join(' '));
    },
  };
  const inputArgs = ['original'];
  const registry = createTestCommandRegistry({
    includeGroups: [],
    commands: [mutating],
  });
  const ctx = createTestCommandContext({ registry });

  const { result } = await runRegisteredCommand('mutate', inputArgs, { ctx });
  assert.equal(stdoutText(result), 'changed');
  assert.deepEqual(inputArgs, ['original']);
});

test('oracle helpers build a world, execute a deterministic script, and assert outcomes', async function (): Promise<void> {
  const scenario: ScenarioSpec = {
    id: 'testing-helper-smoke',
    category: 'structured',
    description: 'Smoke-test the oracle helper pipeline.',
    prompt: 'Fetch order data and extract the customer email.',
    maxTurns: 1,
    maxToolCalls: 1,
    world: {
      fetchResources: {
        'order:1': {
          customer: {
            email: 'buyer@example.com',
          },
        },
      },
    },
    oracle: ['fetch order:1 | json get customer.email'],
    assertions: {
      finalAnswer: {
        contains: ['buyer@example.com'],
      },
      trace: {
        maxCalls: 1,
      },
    },
  };

  const runtime = await buildWorld(scenario.world);
  const trace = await runOracle(runtime, scenario);
  const assertionResult = await assertScenario(scenario, trace, runtime);

  assert.equal(trace.finalExitCode, 0);
  assert.equal(trace.steps.length, 1);
  assert.ok(assertionResult.passed, assertionResult.failures.join('\n'));
});

test('runOracle rejects scenarios without a deterministic oracle script', async function (): Promise<void> {
  const runtime = await buildWorld({});
  const scenario: ScenarioSpec = {
    id: 'missing-oracle',
    category: 'structured',
    description: 'Missing deterministic oracle.',
    prompt: 'No oracle is provided for this scenario.',
    maxTurns: 1,
    maxToolCalls: 1,
    world: {},
    assertions: {},
  };

  await assert.rejects(async function (): Promise<void> {
    await runOracle(runtime, scenario);
  }, /does not define an oracle/);
});

test('DemoFetch clones JSON payloads so fetch calls cannot mutate shared fixture state', async function (): Promise<void> {
  const fetcher = new DemoFetch({
    'order:1': {
      customer: {
        email: 'buyer@example.com',
      },
    },
  });

  const first = await fetcher.fetch('order:1');
  const firstPayload = first.payload as { customer: { email: string } };
  firstPayload.customer.email = 'changed@example.com';

  const second = await fetcher.fetch('order:1');
  const secondPayload = second.payload as { customer: { email: string } };

  assert.equal(secondPayload.customer.email, 'buyer@example.com');
});

test('DemoSearch uses C-locale ordering for tied non-ascii titles', async function (): Promise<void> {
  const search = new DemoSearch([
    { title: 'ä title', body: 'refund issue', source: 'kb://1' },
    { title: 'z title', body: 'refund issue', source: 'kb://2' },
    { title: 'a title', body: 'refund issue', source: 'kb://3' },
    { title: 'É title', body: 'refund issue', source: 'kb://4' },
    { title: 'Ω title', body: 'refund issue', source: 'kb://5' },
  ]);

  const hits = await search.search('refund', 10);
  assert.deepEqual(
    hits.map(function (hit): string {
      return hit.title;
    }),
    ['a title', 'z title', 'É title', 'ä title', 'Ω title'],
  );
});
