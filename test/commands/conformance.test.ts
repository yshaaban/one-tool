import { test } from 'node:test';

import { createCommandConformanceCases } from '../../src/testing/index.js';
import { makeCtx, makeRegistry } from './harness.js';

const cases = createCommandConformanceCases({
  registry: makeRegistry(),
  makeCtx,
  strictMetadata: true,
});

for (const conformanceCase of cases) {
  test(`conformance: ${conformanceCase.commandName} — ${conformanceCase.name}`, async function (): Promise<void> {
    await conformanceCase.run();
  });
}
