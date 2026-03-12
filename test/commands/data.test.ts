import assert from 'node:assert/strict';
import test from 'node:test';

import { textEncoder } from '../../src/types.js';
import { makeCtx, runCommand, stdinText, stdoutText } from './harness.js';

test('data: json pretty prints stdin input', async () => {
  const { result } = await runCommand('json', ['pretty'], {
    stdin: stdinText('{"b":2,"a":1}'),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.contentType, 'application/json');
  assert.match(stdoutText(result), /"a": 1/);
  assert.match(stdoutText(result), /"b": 2/);
});

test('data: json keys sorts object keys from a file', async () => {
  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/data.json', textEncoder.encode('{"z":1,"a":2}'));

  const { result } = await runCommand('json', ['keys', '/data.json'], { ctx });
  assert.equal(result.exitCode, 0);
  assert.equal(stdoutText(result), 'a\nz');
});

test('data: json get extracts nested object and array paths', async () => {
  const ctx = makeCtx();
  await ctx.vfs.writeBytes(
    '/payload.json',
    textEncoder.encode('{"user":{"email":"buyer@acme.example"},"items":[{"id":"A"},{"id":"B"}]}'),
  );

  const email = await runCommand('json', ['get', 'user.email', '/payload.json'], { ctx });
  assert.equal(email.result.exitCode, 0);
  assert.equal(stdoutText(email.result), 'buyer@acme.example');

  const item = await runCommand('json', ['get', 'items[1].id', '/payload.json'], { ctx });
  assert.equal(item.result.exitCode, 0);
  assert.equal(stdoutText(item.result), 'B');
});

test('data: json get reports missing paths and invalid JSON', async () => {
  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/broken.json', textEncoder.encode('{"ok":'));
  await ctx.vfs.writeBytes('/payload.json', textEncoder.encode('{"user":{"email":"buyer@acme.example"}}'));

  const missingPath = await runCommand('json', ['get', 'user.name', '/payload.json'], { ctx });
  assert.equal(missingPath.result.exitCode, 1);
  assert.match(missingPath.result.stderr, /json get: path not found: user\.name/);

  const invalid = await runCommand('json', ['pretty', '/broken.json'], { ctx });
  assert.equal(invalid.result.exitCode, 1);
  assert.match(invalid.result.stderr, /json pretty: invalid JSON/);
});

test('data: calc evaluates expressions and rejects invalid input', async () => {
  const valid = await runCommand('calc', ['(12', '*', '8)', '/', '3']);
  assert.equal(valid.result.exitCode, 0);
  assert.equal(stdoutText(valid.result), '32');

  const invalid = await runCommand('calc', ['2', '+', 'foo']);
  assert.equal(invalid.result.exitCode, 1);
  assert.match(invalid.result.stderr, /calc: invalid expression/);
});

test('data: calc rejects stdin', async () => {
  const { result } = await runCommand('calc', ['1', '+', '1'], { stdin: stdinText('ignored') });
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /calc: does not accept stdin/);
});
