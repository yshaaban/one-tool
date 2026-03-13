import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

import { textDecoder, textEncoder } from '../src/types.js';
import {
  createOracleEnv,
  hasOracleUtility,
  listMissingOracleUtilities,
  oracleDirectory,
  withOracleFixtureWorkspace,
} from './oracles/parity-harness.js';

test('parity harness forces C locale in spawned environments', function (): void {
  const env = createOracleEnv({
    LC_ALL: 'fr_FR.UTF-8',
    LANG: 'ar_SA.UTF-8',
  });

  assert.equal(env.LC_ALL, 'C');
  assert.equal(env.LANG, 'C');
});

test('parity harness seeds files and empty directories inside a temp workspace', async function (): Promise<void> {
  await withOracleFixtureWorkspace(
    {
      empty: oracleDirectory(),
      'nested/input.txt': 'alpha\nbeta\n',
      'nested/raw.bin': new Uint8Array([0, 1, 2, 255]),
    },
    async function (workspace): Promise<void> {
      assert.equal(await readFile(workspace.path('nested/input.txt'), 'utf8'), 'alpha\nbeta\n');
      assert.deepEqual(
        new Uint8Array(await readFile(workspace.path('nested/raw.bin'))),
        new Uint8Array([0, 1, 2, 255]),
      );
      const info = await stat(workspace.path('empty'));
      assert.equal(info.isDirectory(), true);
    },
  );
});

test('parity harness rejects fixture paths that escape the temp workspace', async function (): Promise<void> {
  await assert.rejects(async function (): Promise<void> {
    await withOracleFixtureWorkspace(
      {
        '../escape.txt': 'nope',
      },
      async function (): Promise<void> {},
    );
  }, /oracle fixture escapes root/);
});

test('parity harness reports missing utilities and can run host tr when available', async function (t): Promise<void> {
  const missing = await listMissingOracleUtilities(['one-tool-missing-oracle-bin']);
  assert.deepEqual(missing, ['one-tool-missing-oracle-bin']);

  if (!(await hasOracleUtility('tr'))) {
    t.skip('host tr is not available');
    return;
  }

  await withOracleFixtureWorkspace({}, async function (workspace): Promise<void> {
    const result = await workspace.run('tr', ['a-z', 'A-Z'], {
      stdin: textEncoder.encode('banana'),
    });

    assert.equal(result.exitCode, 0);
    assert.equal(textDecoder.decode(result.stdout), 'BANANA');
    assert.equal(result.stderr, '');
  });
});
