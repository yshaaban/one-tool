import { exampleManifest, type ExampleTier } from './manifest.js';
import {
  createExampleIO,
  printHeading,
  runIfEntrypoint,
  type ExampleRunOptions,
} from './shared/example-utils.js';

const TIERS: readonly ExampleTier[] = ['quickstart', 'recipe', 'app', 'reference'];

export async function main(options: ExampleRunOptions = {}): Promise<void> {
  const io = createExampleIO(options);

  printHeading(
    io,
    'one-tool example catalog',
    'Run a sample with `npm run example -- <slug>`. High-value aliases remain available for `demo`, `agent`, and `example:custom-command`.',
  );

  for (const tier of TIERS) {
    io.write(`\n${tier.toUpperCase()}`);
    io.write('-'.repeat(tier.length));

    for (const example of exampleManifest.filter(function (entry) {
      return entry.tier === tier;
    })) {
      const notes = [
        example.runtime,
        example.deterministic ? 'deterministic' : 'networked',
        example.requiresEnv ? 'env required' : 'no env',
      ].join(' | ');

      io.write(`\n${example.slug}`);
      io.write(`  ${example.title}`);
      io.write(`  ${example.summary}`);
      io.write(`  ${example.runCommand}`);
      io.write(`  ${notes}`);
    }
  }
}

await runIfEntrypoint(import.meta.url, main);
