import test from 'node:test';

import { exampleManifest } from '../examples/manifest.js';

interface ExampleModule {
  main(options?: { quiet?: boolean; args?: string[] }): Promise<void>;
}

for (const entry of exampleManifest.filter(function (example) {
  return example.smokeTest;
})) {
  test(`example smoke: ${entry.slug}`, async function (): Promise<void> {
    const module = (await import(
      new URL(`../${entry.modulePath.replace('./', 'examples/')}`, import.meta.url).href
    )) as Partial<ExampleModule>;
    if (typeof module.main !== 'function') {
      throw new Error(`example does not export main(): ${entry.slug}`);
    }

    await module.main({
      quiet: true,
      args: entry.smokeArgs ? [...entry.smokeArgs] : [],
    });
  });
}
