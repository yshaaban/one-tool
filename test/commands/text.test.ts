import assert from 'node:assert/strict';
import test from 'node:test';

import { textDecoder, textEncoder } from '../../src/types.js';
import { MemoryVFS } from '../../src/vfs/memory-vfs.js';
import { makeCtx, runCommand, stdinText, stdoutText } from './harness.js';

test('text: echo supports newline and escape flags, and rejects stdin', async () => {
  const inline = await runCommand('echo', ['hello', 'world']);
  assert.equal(inline.result.exitCode, 0);
  assert.equal(stdoutText(inline.result), 'hello world\n');

  const empty = await runCommand('echo');
  assert.equal(empty.result.exitCode, 0);
  assert.equal(stdoutText(empty.result), '\n');

  const noNewline = await runCommand('echo', ['-n', 'hello']);
  assert.equal(noNewline.result.exitCode, 0);
  assert.equal(stdoutText(noNewline.result), 'hello');

  const escapes = await runCommand('echo', ['-e', 'line\\none\\tindent']);
  assert.equal(escapes.result.exitCode, 0);
  assert.equal(stdoutText(escapes.result), 'line\none\tindent\n');

  const rawEscapes = await runCommand('echo', ['-e', '-E', 'line\\none']);
  assert.equal(rawEscapes.result.exitCode, 0);
  assert.equal(stdoutText(rawEscapes.result), 'line\\none\n');

  const doubleDashLiteral = await runCommand('echo', ['--', 'value']);
  assert.equal(doubleDashLiteral.result.exitCode, 0);
  assert.equal(stdoutText(doubleDashLiteral.result), '-- value\n');

  const stdin = await runCommand('echo', [], { stdin: stdinText('ignored') });
  assert.equal(stdin.result.exitCode, 1);
  assert.match(stdin.result.stderr, /echo: does not accept stdin/);
});

test('text: grep filters file content with flags', async () => {
  const ctx = makeCtx();
  await ctx.vfs.writeBytes(
    '/logs/app.log',
    textEncoder.encode('INFO startup\nerror timeout\nWARN retry\nerror db\nerror timeout timeout'),
  );

  const insensitive = await runCommand('grep', ['-i', '-n', 'error', '/logs/app.log'], { ctx });
  assert.equal(insensitive.result.exitCode, 0);
  assert.equal(stdoutText(insensitive.result), '2:error timeout\n4:error db\n5:error timeout timeout');

  const inverted = await runCommand('grep', ['-v', 'WARN', '/logs/app.log'], { ctx });
  assert.equal(inverted.result.exitCode, 0);
  assert.doesNotMatch(stdoutText(inverted.result), /WARN retry/);

  const fixed = await runCommand('grep', ['-F', '-o', 'timeout', '/logs/app.log'], { ctx });
  assert.equal(fixed.result.exitCode, 0);
  assert.equal(stdoutText(fixed.result), 'timeout\ntimeout\ntimeout');

  const wholeWord = await runCommand('grep', ['-F', '-w', 'error', '/logs/app.log'], { ctx });
  assert.equal(wholeWord.result.exitCode, 0);
  assert.equal(stdoutText(wholeWord.result), 'error timeout\nerror db\nerror timeout timeout');

  const wholeLine = await runCommand('grep', ['-x', 'WARN retry', '/logs/app.log'], { ctx });
  assert.equal(wholeLine.result.exitCode, 0);
  assert.equal(stdoutText(wholeLine.result), 'WARN retry');
});

test('text: grep supports stdin, counts, and invalid regex errors', async () => {
  const counted = await runCommand('grep', ['-c', 'refund'], {
    stdin: stdinText('refund created\nrefund updated\nskip'),
  });
  assert.equal(counted.result.exitCode, 0);
  assert.equal(stdoutText(counted.result), '2');

  const quietMatch = await runCommand('grep', ['-q', 'refund'], {
    stdin: stdinText('refund created\nskip'),
  });
  assert.equal(quietMatch.result.exitCode, 0);
  assert.equal(stdoutText(quietMatch.result), '');

  const noMatch = await runCommand('grep', ['-F', 'missing'], {
    stdin: stdinText('refund created\nrefund updated\nskip'),
  });
  assert.equal(noMatch.result.exitCode, 1);
  assert.equal(stdoutText(noMatch.result), '');

  const noMatchCount = await runCommand('grep', ['-F', '-c', 'missing'], {
    stdin: stdinText('refund created\nrefund updated\nskip'),
  });
  assert.equal(noMatchCount.result.exitCode, 1);
  assert.equal(stdoutText(noMatchCount.result), '0');

  const onlyMatches = await runCommand('grep', ['-E', '-o', 'refund|updated'], {
    stdin: stdinText('refund created\nrefund updated\nskip'),
  });
  assert.equal(onlyMatches.result.exitCode, 0);
  assert.equal(stdoutText(onlyMatches.result), 'refund\nrefund\nupdated');

  const invalid = await runCommand('grep', ['[unterminated'], {
    stdin: stdinText('anything'),
  });
  assert.equal(invalid.result.exitCode, 1);
  assert.match(invalid.result.stderr, /grep: invalid regex/);
});

test('text: head reads lines and bytes, and rejects binary stdin in line mode', async () => {
  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/notes.txt', textEncoder.encode('a\nb\nc\nd'));
  await ctx.vfs.writeBytes('/bytes.bin', new Uint8Array([0, 1, 2, 3, 4]));

  const fileResult = await runCommand('head', ['-n', '2', '/notes.txt'], { ctx });
  assert.equal(fileResult.result.exitCode, 0);
  assert.equal(stdoutText(fileResult.result), 'a\nb\n');

  const stdinResult = await runCommand('head', ['-n', '3'], { stdin: stdinText('a\nb\nc\nd') });
  assert.equal(stdinResult.result.exitCode, 0);
  assert.equal(stdoutText(stdinResult.result), 'a\nb\nc\n');

  const byteResult = await runCommand('head', ['-c', '3', '/bytes.bin'], { ctx });
  assert.equal(byteResult.result.exitCode, 0);
  assert.deepEqual(Array.from(byteResult.result.stdout), [0, 1, 2]);

  const attachedByteCount = await runCommand('head', ['-c3', '/bytes.bin'], { ctx });
  assert.equal(attachedByteCount.result.exitCode, 0);
  assert.deepEqual(Array.from(attachedByteCount.result.stdout), [0, 1, 2]);

  const shorthand = await runCommand('head', ['-2', '/notes.txt'], { ctx });
  assert.equal(shorthand.result.exitCode, 0);
  assert.equal(stdoutText(shorthand.result), 'a\nb\n');

  const binary = await runCommand('head', [], { stdin: new Uint8Array([0, 1, 2]) });
  assert.equal(binary.result.exitCode, 1);
  assert.match(binary.result.stderr, /head: stdin is binary/);
});

test('text: tail reads lines and bytes from stdin and file paths', async () => {
  const fromStdin = await runCommand('tail', ['-n', '2'], {
    stdin: stdinText('a\nb\nc\nd'),
  });
  assert.equal(fromStdin.result.exitCode, 0);
  assert.equal(stdoutText(fromStdin.result), 'c\nd');

  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/tail.txt', textEncoder.encode('1\n2\n3\n4'));
  await ctx.vfs.writeBytes('/bytes.bin', new Uint8Array([0, 1, 2, 3, 4]));
  const fromFile = await runCommand('tail', ['/tail.txt'], { ctx });
  assert.equal(fromFile.result.exitCode, 0);
  assert.equal(stdoutText(fromFile.result), '1\n2\n3\n4');

  const byteTail = await runCommand('tail', ['-c', '2', '/bytes.bin'], { ctx });
  assert.equal(byteTail.result.exitCode, 0);
  assert.deepEqual(Array.from(byteTail.result.stdout), [3, 4]);

  const attachedByteTail = await runCommand('tail', ['-c2', '/bytes.bin'], { ctx });
  assert.equal(attachedByteTail.result.exitCode, 0);
  assert.deepEqual(Array.from(attachedByteTail.result.stdout), [3, 4]);

  const shorthandTail = await runCommand('tail', ['-2', '/tail.txt'], { ctx });
  assert.equal(shorthandTail.result.exitCode, 0);
  assert.equal(stdoutText(shorthandTail.result), '3\n4');
});

test('text: sort orders lines lexically, numerically, case-insensitively, by version, and uniquely', async () => {
  const lexical = await runCommand('sort', [], {
    stdin: stdinText('pear\napple\nbanana\napple'),
  });
  assert.equal(lexical.result.exitCode, 0);
  assert.equal(stdoutText(lexical.result), 'apple\napple\nbanana\npear');

  const numeric = await runCommand('sort', ['-n'], {
    stdin: stdinText('10\n2\n30\napple'),
  });
  assert.equal(numeric.result.exitCode, 0);
  assert.equal(stdoutText(numeric.result), 'apple\n2\n10\n30');

  const unique = await runCommand('sort', ['-u'], {
    stdin: stdinText('pear\napple\npear\napple'),
  });
  assert.equal(unique.result.exitCode, 0);
  assert.equal(stdoutText(unique.result), 'apple\npear');

  const numericUnique = await runCommand('sort', ['-n', '-u'], {
    stdin: stdinText('2\n02\napple\napple'),
  });
  assert.equal(numericUnique.result.exitCode, 0);
  assert.equal(stdoutText(numericUnique.result), 'apple\n2');

  const folded = await runCommand('sort', ['-f'], {
    stdin: stdinText('beta\nAlpha\napple'),
  });
  assert.equal(folded.result.exitCode, 0);
  assert.equal(stdoutText(folded.result), 'Alpha\napple\nbeta');

  const versioned = await runCommand('sort', ['-V'], {
    stdin: stdinText('v1.10\nv1.2\nv1.3'),
  });
  assert.equal(versioned.result.exitCode, 0);
  assert.equal(stdoutText(versioned.result), 'v1.2\nv1.3\nv1.10');

  const foldedUnique = await runCommand('sort', ['-f', '-u'], {
    stdin: stdinText('a\nA\nbeta'),
  });
  assert.equal(foldedUnique.result.exitCode, 0);
  assert.equal(stdoutText(foldedUnique.result), 'a\nbeta');

  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/versions.txt', textEncoder.encode('v1.10\nv1.2\nv1.3'));
  const fileSort = await runCommand('sort', ['-V', '/versions.txt'], { ctx });
  assert.equal(fileSort.result.exitCode, 0);
  assert.equal(stdoutText(fileSort.result), 'v1.2\nv1.3\nv1.10');
});

test('text: tr translates, deletes, squeezes, and preserves empty stdin', async () => {
  const translated = await runCommand('tr', ['a-z', 'A-Z'], {
    stdin: stdinText('banana'),
  });
  assert.equal(translated.result.exitCode, 0);
  assert.equal(stdoutText(translated.result), 'BANANA');

  const deleted = await runCommand('tr', ['-d', '0-9'], {
    stdin: stdinText('a1b2c3'),
  });
  assert.equal(deleted.result.exitCode, 0);
  assert.equal(stdoutText(deleted.result), 'abc');

  const squeezed = await runCommand('tr', ['-s', ' '], {
    stdin: stdinText('a   b'),
  });
  assert.equal(squeezed.result.exitCode, 0);
  assert.equal(stdoutText(squeezed.result), 'a b');

  const empty = await runCommand('tr', ['a-z', 'A-Z']);
  assert.equal(empty.result.exitCode, 0);
  assert.equal(stdoutText(empty.result), '');
});

test('text: tr reports operand and class-alignment errors', async () => {
  const emptyString2 = await runCommand('tr', ['a', '']);
  assert.equal(emptyString2.result.exitCode, 1);
  assert.match(emptyString2.result.stderr, /tr: when not truncating set1, string2 must be non-empty/);

  const misalignedClass = await runCommand('tr', ['0-9', '[:upper:]']);
  assert.equal(misalignedClass.result.exitCode, 1);
  assert.match(misalignedClass.result.stderr, /tr: misaligned \[:upper:\] and\/or \[:lower:\] construct/);
});

test('text: sed substitutes text from stdin and supports explicit printing', async () => {
  const substituted = await runCommand('sed', ['s/ERROR/WARN/g'], {
    stdin: stdinText('ERROR one\nERROR two\n'),
  });
  assert.equal(substituted.result.exitCode, 0);
  assert.equal(stdoutText(substituted.result), 'WARN one\nWARN two\n');

  const explicitPrint = await runCommand('sed', ['-n', '2p'], {
    stdin: stdinText('alpha\nbeta\ngamma\n'),
  });
  assert.equal(explicitPrint.result.exitCode, 0);
  assert.equal(stdoutText(explicitPrint.result), 'beta\n');

  const fromSecondMatch = await runCommand('sed', ['s/a/A/2g'], {
    stdin: stdinText('a a a\n'),
  });
  assert.equal(fromSecondMatch.result.exitCode, 0);
  assert.equal(stdoutText(fromSecondMatch.result), 'a A A\n');

  const groupedFlags = await runCommand('sed', ['-ne', '2p'], {
    stdin: stdinText('alpha\nbeta\ngamma\n'),
  });
  assert.equal(groupedFlags.result.exitCode, 0);
  assert.equal(stdoutText(groupedFlags.result), 'beta\n');
});

test('text: sed supports insert, append, change, and script files', async () => {
  const insertAppend = await runCommand('sed', ['-e', '1i\\TOP', '-e', '2a\\BOTTOM'], {
    stdin: stdinText('alpha\nbeta\n'),
  });
  assert.equal(insertAppend.result.exitCode, 0);
  assert.equal(stdoutText(insertAppend.result), 'TOP\nalpha\nbeta\nBOTTOM\n');

  const changed = await runCommand('sed', ['2,3c\\X'], {
    stdin: stdinText('a\nb\nc\nd\n'),
  });
  assert.equal(changed.result.exitCode, 0);
  assert.equal(stdoutText(changed.result), 'a\nX\nd\n');

  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/scripts/rewrite.sed', textEncoder.encode('s/foo/bar/\n2p\n'));
  await ctx.vfs.writeBytes('/input.txt', textEncoder.encode('foo\nfoo\n'));

  const fromScriptFile = await runCommand('sed', ['-n', '-f', '/scripts/rewrite.sed', '/input.txt'], { ctx });
  assert.equal(fromScriptFile.result.exitCode, 0);
  assert.equal(stdoutText(fromScriptFile.result), 'bar\n');

  const groupedScriptFlag = await runCommand('sed', ['-nEf/scripts/rewrite.sed', '/input.txt'], { ctx });
  assert.equal(groupedScriptFlag.result.exitCode, 0);
  assert.equal(stdoutText(groupedScriptFlag.result), 'bar\n');
});

test('text: sed decodes escaped newlines and tabs in text arguments and replacements', async () => {
  const cases = [
    {
      args: ['2a\\line A\\n\\tline B'],
      stdin: 'alpha\nbeta\n',
      stdout: 'alpha\nbeta\nline A\n\tline B\n',
    },
    {
      args: ['2,3c\\line 1\\nline 2'],
      stdin: 'a\nb\nc\nd\n',
      stdout: 'a\nline 1\nline 2\nd\n',
    },
    {
      args: ['2i\\line 0\\n\\tline 0.5'],
      stdin: 'alpha\nbeta\n',
      stdout: 'alpha\nline 0\n\tline 0.5\nbeta\n',
    },
    {
      args: ['s/foo/bar\\n\\tbaz/'],
      stdin: 'foo\n',
      stdout: 'bar\n\tbaz\n',
    },
    {
      args: ['s/foo/[&]/'],
      stdin: 'foo\n',
      stdout: '[foo]\n',
    },
    {
      args: ['s/\\(foo\\)/[\\1]/'],
      stdin: 'foo\n',
      stdout: '[foo]\n',
    },
    {
      args: ['-E', 's/x=([0-9]+),y=([0-9]+)/\\2,\\1/'],
      stdin: 'x=10,y=20\n',
      stdout: '20,10\n',
    },
  ];

  for (const testCase of cases) {
    const result = await runCommand('sed', testCase.args, {
      stdin: stdinText(testCase.stdin),
    });
    assert.equal(result.result.exitCode, 0);
    assert.equal(stdoutText(result.result), testCase.stdout);
  }
});

test('text: sed supports in-place editing and backup suffixes', async () => {
  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/notes.txt', textEncoder.encode('alpha\nbeta\n'));

  const result = await runCommand('sed', ['-i.bak', 's/alpha/ALPHA/', '/notes.txt'], { ctx });
  assert.equal(result.result.exitCode, 0);
  assert.equal(stdoutText(result.result), '');

  const rewritten = await ctx.vfs.readBytes('/notes.txt');
  assert.equal(textDecoder.decode(rewritten), 'ALPHA\nbeta\n');

  const backup = await ctx.vfs.readBytes('/notes.txt.bak');
  assert.equal(textDecoder.decode(backup), 'alpha\nbeta\n');
});

test('text: sed reports usage and script errors clearly', async () => {
  const missingScript = await runCommand('sed', []);
  assert.equal(missingScript.result.exitCode, 1);
  assert.match(missingScript.result.stderr, /sed: missing script/);

  const missingScriptFile = await runCommand('sed', ['-f', '/missing.sed', '/input.txt']);
  assert.equal(missingScriptFile.result.exitCode, 1);
  assert.match(missingScriptFile.result.stderr, /sed: script file not found: \/missing\.sed/);

  const unsupported = await runCommand('sed', ['x']);
  assert.equal(unsupported.result.exitCode, 1);
  assert.match(unsupported.result.stderr, /sed: unsupported sed command: x/);
});

test('text: sed formats parent-not-directory and in-place resource-limit failures cleanly', async () => {
  const blockedCtx = makeCtx();
  await blockedCtx.vfs.writeBytes('/blocked', textEncoder.encode('x'));

  const blockedInput = await runCommand('sed', ['s/a/b/', '/blocked/input.txt'], { ctx: blockedCtx });
  assert.equal(blockedInput.result.exitCode, 1);
  assert.match(blockedInput.result.stderr, /sed: parent is not a directory: \/blocked/);

  const blockedScript = await runCommand('sed', ['-f', '/blocked/rewrite.sed', '/input.txt'], {
    ctx: blockedCtx,
  });
  assert.equal(blockedScript.result.exitCode, 1);
  assert.match(blockedScript.result.stderr, /sed: parent is not a directory: \/blocked/);

  const limitedCtx = makeCtx({
    vfs: new MemoryVFS({
      resourcePolicy: {
        maxTotalBytes: 6,
      },
    }),
  });
  await limitedCtx.vfs.writeBytes('/notes.txt', textEncoder.encode('abcd'));

  const limited = await runCommand('sed', ['-i.bak', 's/a/A/', '/notes.txt'], { ctx: limitedCtx });
  assert.equal(limited.result.exitCode, 1);
  assert.match(
    limited.result.stderr,
    /sed: resource limit exceeded \(maxTotalBytes: 8 > 6\) at \/notes\.txt\.bak/,
  );

  const unchanged = await limitedCtx.vfs.readBytes('/notes.txt');
  assert.equal(textDecoder.decode(unchanged), 'abcd');
});

test('text: uniq collapses adjacent duplicates and supports counts and group filters', async () => {
  const basic = await runCommand('uniq', [], {
    stdin: stdinText('a\na\nb\na\na'),
  });
  assert.equal(basic.result.exitCode, 0);
  assert.equal(stdoutText(basic.result), 'a\nb\na');

  const counted = await runCommand('uniq', ['-c'], {
    stdin: stdinText('a\na\nb\nb\nb'),
  });
  assert.equal(counted.result.exitCode, 0);
  assert.equal(stdoutText(counted.result), '      2 a\n      3 b');

  const insensitive = await runCommand('uniq', ['-i'], {
    stdin: stdinText('Error\nerror\nWARN'),
  });
  assert.equal(insensitive.result.exitCode, 0);
  assert.equal(stdoutText(insensitive.result), 'Error\nWARN');

  const duplicatesOnly = await runCommand('uniq', ['-d'], {
    stdin: stdinText('a\na\nb\nc\nc'),
  });
  assert.equal(duplicatesOnly.result.exitCode, 0);
  assert.equal(stdoutText(duplicatesOnly.result), 'a\nc');

  const uniquesOnly = await runCommand('uniq', ['-u'], {
    stdin: stdinText('a\na\nb\nc\nc'),
  });
  assert.equal(uniquesOnly.result.exitCode, 0);
  assert.equal(stdoutText(uniquesOnly.result), 'b');
});

test('text: wc reports line, word, and byte counts', async () => {
  const ctx = makeCtx();
  await ctx.vfs.writeBytes('/counts.txt', textEncoder.encode('alpha beta\ngamma'));

  const summary = await runCommand('wc', ['/counts.txt'], { ctx });
  assert.equal(summary.result.exitCode, 0);
  assert.equal(stdoutText(summary.result), ' 1  3 16 /counts.txt');

  const linesOnly = await runCommand('wc', ['-l', '/counts.txt'], { ctx });
  assert.equal(linesOnly.result.exitCode, 0);
  assert.equal(stdoutText(linesOnly.result), '1 /counts.txt');

  const wordsAndBytes = await runCommand('wc', ['-w', '-c'], {
    stdin: stdinText('one two'),
  });
  assert.equal(wordsAndBytes.result.exitCode, 0);
  assert.equal(stdoutText(wordsAndBytes.result), '      2       7');
});
