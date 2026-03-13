import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { exampleManifest, getExampleBySlug } from '../examples/manifest.js';
import { main as listExamples } from '../examples/list.js';
import { main as runExample } from '../examples/run.js';

test('example manifest is complete and internally consistent', async function (): Promise<void> {
  assert.equal(exampleManifest.length, 19);
  const examplesGuide = readFileSync(path.join(process.cwd(), 'docs/examples.md'), 'utf8');

  const tierCounts = new Map<string, number>();
  const seenSlugs = new Set<string>();

  for (const entry of exampleManifest) {
    assert.ok(!seenSlugs.has(entry.slug), `duplicate example slug: ${entry.slug}`);
    seenSlugs.add(entry.slug);
    tierCounts.set(entry.tier, (tierCounts.get(entry.tier) ?? 0) + 1);

    assert.ok(entry.runCommand.length > 0, `${entry.slug} should have a run command`);
    assert.ok(entry.sourcePath.endsWith('.ts'), `${entry.slug} should point to a TypeScript source file`);
    assert.ok(getExampleBySlug(entry.slug), `${entry.slug} should be discoverable by slug`);
    assert.match(
      examplesGuide,
      new RegExp(`\\\`${entry.slug}\\\``),
      `docs/examples.md should list ${entry.slug}`,
    );

    const source = readFileSync(path.join(process.cwd(), entry.sourcePath), 'utf8');
    if (entry.tier !== 'reference') {
      assert.doesNotMatch(source, /from ['"]\.\.\/src\//, `${entry.slug} should use public package imports`);
      assert.doesNotMatch(
        source,
        /from ['"]\.\.\/\.\.\/src\//,
        `${entry.slug} should use public package imports`,
      );
    }
  }

  assert.deepEqual(
    Object.fromEntries(
      [...tierCounts.entries()].sort(function (a, b) {
        return a[0].localeCompare(b[0]);
      }),
    ),
    {
      app: 4,
      quickstart: 4,
      recipe: 8,
      reference: 3,
    },
  );

  await listExamples({ quiet: true });
  await runExample({ quiet: true, args: ['quickstart-node-basic'] });
});
