import process from 'node:process';

import { getExampleBySlug } from './manifest.js';
import {
  createExampleIO,
  getExampleArgs,
  runIfEntrypoint,
  type ExampleRunOptions,
} from './shared/example-utils.js';

interface RunnableExampleModule {
  main(options?: ExampleRunOptions): Promise<void>;
}

export async function main(options: ExampleRunOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const args = getExampleArgs(options);
  const slug = args[0];

  if (!slug) {
    io.error('Usage: npm run example -- <slug>');
    io.error('Run `npm run examples:list` to see the catalog.');
    process.exitCode = 1;
    return;
  }

  const entry = getExampleBySlug(slug);
  if (!entry) {
    io.error(`Unknown example slug: ${slug}`);
    io.error('Run `npm run examples:list` to see the catalog.');
    process.exitCode = 1;
    return;
  }

  const moduleUrl = new URL(entry.modulePath, import.meta.url);
  const module = (await import(moduleUrl.href)) as Partial<RunnableExampleModule>;
  if (typeof module.main !== 'function') {
    throw new Error(`example module does not export main(): ${entry.sourcePath}`);
  }

  await module.main({
    ...options,
    args: args.slice(1),
  });
}

await runIfEntrypoint(import.meta.url, main);
