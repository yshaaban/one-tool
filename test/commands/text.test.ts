import assert from 'node:assert/strict';
import test from 'node:test';

import { textEncoder } from '../../src/types.js';
import { makeCtx, runCommand, stdinText, stdoutText } from './harness.js';

test('text: grep filters file content with flags', async () => {
  const ctx = makeCtx();
  await ctx.vfs.writeBytes(
    '/logs/app.log',
    textEncoder.encode('INFO startup\nerror timeout\nWARN retry\nerror db'),
  );

  const insensitive = await runCommand('grep', ['-i', '-n', 'error', '/logs/app.log'], { ctx });
  assert.equal(insensitive.result.exitCode, 0);
  assert.equal(stdoutText(insensitive.result), '2:error timeout\n4:error db');

  const inverted = await runCommand('grep', ['-v', 'WARN', '/logs/app.log'], { ctx });
  assert.equal(inverted.result.exitCode, 0);
  assert.doesNotMatch(stdoutText(inverted.result), /WARN retry/);
});

test('text: grep supports stdin, counts, and invalid regex errors', async () => {
  const counted = await runCommand('grep', ['-c', 'refund'], {
    stdin: stdinText('refund created\nrefund updated\nskip'),
  });
  assert.equal(counted.result.exitCode, 0);
  assert.equal(stdoutText(counted.result), '2');

  const invalid = await runCommand('grep', ['[unterminated'], {
    stdin: stdinText('anything'),
  });
  assert.equal(invalid.result.exitCode, 1);
  assert.match(invalid.result.stderr, /grep: invalid regex/);
});

test('text: head reads from files and stdin, and rejects binary stdin', async () => {
  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/notes.txt', textEncoder.encode('a\nb\nc\nd'));

  const fileResult = await runCommand('head', ['-n', '2', '/notes.txt'], { ctx });
  assert.equal(fileResult.result.exitCode, 0);
  assert.equal(stdoutText(fileResult.result), 'a\nb');

  const stdinResult = await runCommand('head', ['-n', '3'], { stdin: stdinText('a\nb\nc\nd') });
  assert.equal(stdinResult.result.exitCode, 0);
  assert.equal(stdoutText(stdinResult.result), 'a\nb\nc');

  const binary = await runCommand('head', [], { stdin: new Uint8Array([0, 1, 2]) });
  assert.equal(binary.result.exitCode, 1);
  assert.match(binary.result.stderr, /head: stdin is binary/);
});

test('text: tail reads from stdin and file paths', async () => {
  const fromStdin = await runCommand('tail', ['-n', '2'], {
    stdin: stdinText('a\nb\nc\nd'),
  });
  assert.equal(fromStdin.result.exitCode, 0);
  assert.equal(stdoutText(fromStdin.result), 'c\nd');

  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/tail.txt', textEncoder.encode('1\n2\n3\n4'));
  const fromFile = await runCommand('tail', ['/tail.txt'], { ctx });
  assert.equal(fromFile.result.exitCode, 0);
  assert.equal(stdoutText(fromFile.result), '1\n2\n3\n4');
});
