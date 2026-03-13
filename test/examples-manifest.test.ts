import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const TOP_LEVEL_EXAMPLES = [
  '01-hello-world.ts',
  '02-custom-command.ts',
  '03-readonly-agent.ts',
  '04-detailed-execution.ts',
  '05-adapters.ts',
  '06-browser-persistence.ts',
  '07-mcp-server.ts',
  '08-llm-agent.ts',
  'README.md',
  'agent-support.ts',
] as const;

const ADVANCED_EXAMPLES = [
  'command-selection.ts',
  'command-overrides.ts',
  'extension-helpers.ts',
  'overflow-and-binary.ts',
  'prompt-variants.ts',
  'scenario-testing.ts',
  'testing-custom-commands.ts',
  'http-tool-endpoint.ts',
] as const;

const REPO_ROOT = process.cwd();
const EXAMPLES_DIR = path.join(REPO_ROOT, 'examples');
const ADVANCED_EXAMPLES_DIR = path.join(EXAMPLES_DIR, 'advanced');

function examplePath(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments);
}

test('example layout is curated and documented', function (): void {
  const examplesReadme = readFileSync(path.join(EXAMPLES_DIR, 'README.md'), 'utf8');

  for (const fileName of TOP_LEVEL_EXAMPLES) {
    assert.ok(existsSync(path.join(EXAMPLES_DIR, fileName)), `missing examples/${fileName}`);
  }

  for (const fileName of ADVANCED_EXAMPLES) {
    assert.ok(
      existsSync(path.join(ADVANCED_EXAMPLES_DIR, fileName)),
      `missing examples/advanced/${fileName}`,
    );
  }

  for (const removedPath of [
    'examples/manifest.ts',
    'examples/run.ts',
    'examples/list.ts',
    'examples/agent.ts',
    'examples/custom-command.ts',
    'examples/demo-app.ts',
    'examples/demo-runtime.ts',
    'examples/demo-adapters.ts',
    'examples/shared',
    'examples/apps',
    'examples/recipes',
    'examples/reference',
  ]) {
    assert.equal(existsSync(examplePath(removedPath)), false, `${removedPath} should be removed`);
  }

  for (const fileName of TOP_LEVEL_EXAMPLES.filter(function (entry) {
    return entry.endsWith('.ts');
  })) {
    assert.match(examplesReadme, new RegExp(`\\\`${fileName}\\\``), `${fileName} should be documented`);
  }

  for (const fileName of ADVANCED_EXAMPLES) {
    assert.match(
      examplesReadme,
      new RegExp(`advanced/${fileName.replace('.', '\\.')}`),
      `${fileName} should be listed as advanced`,
    );
  }
});
