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

test('text: sort orders lines lexically, numerically, and uniquely', async () => {
  const lexical = await runCommand('sort', [], {
    stdin: stdinText('pear\napple\nbanana\napple'),
  });
  assert.equal(lexical.result.exitCode, 0);
  assert.equal(stdoutText(lexical.result), 'apple\napple\nbanana\npear');

  const numeric = await runCommand('sort', ['-n'], {
    stdin: stdinText('10\n2\n30\napple'),
  });
  assert.equal(numeric.result.exitCode, 0);
  assert.equal(stdoutText(numeric.result), '2\n10\n30\napple');

  const unique = await runCommand('sort', ['-u'], {
    stdin: stdinText('pear\napple\npear\napple'),
  });
  assert.equal(unique.result.exitCode, 0);
  assert.equal(stdoutText(unique.result), 'apple\npear');
});

test('text: uniq collapses adjacent duplicates and supports counts', async () => {
  const basic = await runCommand('uniq', [], {
    stdin: stdinText('a\na\nb\na\na'),
  });
  assert.equal(basic.result.exitCode, 0);
  assert.equal(stdoutText(basic.result), 'a\nb\na');

  const counted = await runCommand('uniq', ['-c'], {
    stdin: stdinText('a\na\nb\nb\nb'),
  });
  assert.equal(counted.result.exitCode, 0);
  assert.equal(stdoutText(counted.result), '2\ta\n3\tb');

  const insensitive = await runCommand('uniq', ['-i'], {
    stdin: stdinText('Error\nerror\nWARN'),
  });
  assert.equal(insensitive.result.exitCode, 0);
  assert.equal(stdoutText(insensitive.result), 'Error\nWARN');
});

test('text: wc reports line, word, and byte counts', async () => {
  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/counts.txt', textEncoder.encode('alpha beta\ngamma\n'));

  const summary = await runCommand('wc', ['/counts.txt'], { ctx });
  assert.equal(summary.result.exitCode, 0);
  assert.equal(stdoutText(summary.result), 'lines: 2\nwords: 3\nbytes: 17');

  const linesOnly = await runCommand('wc', ['-l', '/counts.txt'], { ctx });
  assert.equal(linesOnly.result.exitCode, 0);
  assert.equal(stdoutText(linesOnly.result), '2');

  const wordsAndBytes = await runCommand('wc', ['-w', '-c'], {
    stdin: stdinText('one two'),
  });
  assert.equal(wordsAndBytes.result.exitCode, 0);
  assert.equal(stdoutText(wordsAndBytes.result), 'words: 2\nbytes: 7');
});
