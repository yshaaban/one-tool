import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

function runCustomCommandExample(): { status: number | null; output: string } {
  const examplePath = fileURLToPath(new URL('../examples/custom-command.js', import.meta.url));
  const result = spawnSync(process.execPath, ['--enable-source-maps', examplePath], {
    encoding: 'utf8',
  });

  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}

test('custom command example runs with selective built-ins and pipelines', () => {
  const result = runCustomCommandExample();

  assert.equal(result.status, 0);
  assert.match(result.output, /Available commands:/);
  assert.match(result.output, /ticket\s+— Inspect a mock support queue/);
  assert.match(result.output, /\$ ticket lookup TICKET-123 \| json get status/);
  assert.match(result.output, /\nopen\n/);
  assert.match(result.output, /\$ ticket list --open \| head -n 2/);
  assert.match(result.output, /TICKET-123\thigh\tRefund timeout on enterprise checkout/);
  assert.match(result.output, /\$ cat \/reports\/ticket-123\.json \| json get customer\.email/);
  assert.match(result.output, /\nops@acme\.example\n/);
});
