import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

function runDemoScript(input: string): { status: number | null; output: string } {
  const demoPath = fileURLToPath(new URL('../examples/demo-app.js', import.meta.url));
  const result = spawnSync(process.execPath, ['--enable-source-maps', demoPath], {
    encoding: 'utf8',
    input,
  });

  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

test('demo app handles piped multi-command input cleanly', () => {
  const result = runDemoScript('help find\nhelp sort\nquit\n');
  assert.equal(result.status, 0);
  assert.match(result.output, /find: Recursively list files and directories with optional filters\./);
  assert.match(result.output, /sort: Sort lines from stdin or a file\./);
  assert.doesNotMatch(result.output, /Detected unsettled top-level await/);
});

test('demo app supports piped command examples for new commands', () => {
  const result = runDemoScript('find /config --type file --name "*.json" | wc -l\nquit\n');
  assert.equal(result.status, 0);
  assert.match(result.output, /\n2\n/);
  assert.doesNotMatch(result.output, /Detected unsettled top-level await/);
});
