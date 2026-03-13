import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

function runDemoScript(input: string): { status: number | null; output: string } {
  const demoPath = fileURLToPath(new URL('../examples/01-hello-world.js', import.meta.url));
  const result = spawnSync(process.execPath, ['--enable-source-maps', demoPath], {
    encoding: 'utf8',
    input,
  });

  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

test('demo example runs cleanly as a standalone script', () => {
  const result = runDemoScript('');
  assert.equal(result.status, 0);
  assert.match(result.output, /01 · Hello world/);
  assert.match(result.output, /\$ write \/hello\.txt "Hello from one-tool"/);
  assert.match(result.output, /\nHello from one-tool\n/);
  assert.doesNotMatch(result.output, /Detected unsettled top-level await/);
});
