import assert from 'node:assert/strict';
import test from 'node:test';

import { ParseError, parseCommandLine, tokenizeCommandLine } from '../src/parser.js';

test('tokenizeCommandLine tokenizes simple commands and operators', function (): void {
  assert.deepEqual(tokenizeCommandLine('ls /foo'), ['ls', '/foo']);
  assert.deepEqual(tokenizeCommandLine('a | b && c || d ; e'), [
    'a',
    '|',
    'b',
    '&&',
    'c',
    '||',
    'd',
    ';',
    'e',
  ]);
});

test('tokenizeCommandLine preserves quoted strings and escaped characters', function (): void {
  assert.deepEqual(tokenizeCommandLine("write /f 'hello world'"), ['write', '/f', 'hello world']);
  assert.deepEqual(tokenizeCommandLine('write /f "hello world"'), ['write', '/f', 'hello world']);
  assert.deepEqual(tokenizeCommandLine('write /f "say \\"hi\\""'), ['write', '/f', 'say "hi"']);
});

test('tokenizeCommandLine rejects unsupported shell constructs', function (): void {
  const invalidInputs = [
    '',
    'write /f "unterminated',
    'write /f trailing\\',
    'echo $(whoami)',
    'echo `whoami`',
    'cat /f > out.txt',
    'cat /f < in.txt',
    'long_task &',
  ];

  for (const input of invalidInputs) {
    assert.throws(function (): string[] {
      return tokenizeCommandLine(input);
    }, ParseError);
  }
});

test('parseCommandLine parses a single command', function (): void {
  assert.deepEqual(parseCommandLine('ls'), [
    {
      relationFromPrevious: null,
      pipeline: { commands: [{ argv: ['ls'] }] },
    },
  ]);
});

test('parseCommandLine parses pipelines', function (): void {
  assert.deepEqual(parseCommandLine('cat /f | grep x'), [
    {
      relationFromPrevious: null,
      pipeline: {
        commands: [{ argv: ['cat', '/f'] }, { argv: ['grep', 'x'] }],
      },
    },
  ]);
});

test('parseCommandLine parses chain operators and mixed command structure', function (): void {
  assert.deepEqual(parseCommandLine('a && b || c ; d'), [
    {
      relationFromPrevious: null,
      pipeline: { commands: [{ argv: ['a'] }] },
    },
    {
      relationFromPrevious: '&&',
      pipeline: { commands: [{ argv: ['b'] }] },
    },
    {
      relationFromPrevious: '||',
      pipeline: { commands: [{ argv: ['c'] }] },
    },
    {
      relationFromPrevious: ';',
      pipeline: { commands: [{ argv: ['d'] }] },
    },
  ]);

  assert.deepEqual(parseCommandLine('a | b && c || d ; e'), [
    {
      relationFromPrevious: null,
      pipeline: {
        commands: [{ argv: ['a'] }, { argv: ['b'] }],
      },
    },
    {
      relationFromPrevious: '&&',
      pipeline: { commands: [{ argv: ['c'] }] },
    },
    {
      relationFromPrevious: '||',
      pipeline: { commands: [{ argv: ['d'] }] },
    },
    {
      relationFromPrevious: ';',
      pipeline: { commands: [{ argv: ['e'] }] },
    },
  ]);
});

test('parseCommandLine preserves long built-in inspection commands', function (): void {
  assert.deepEqual(
    parseCommandLine(
      "echo '--- types ---' && sed -n '1,2p' /docs/types.txt && echo \"--- tests ---\" && grep -E 'cat:|mkdir:|rm:' /docs/tests.txt",
    ),
    [
      {
        relationFromPrevious: null,
        pipeline: { commands: [{ argv: ['echo', '--- types ---'] }] },
      },
      {
        relationFromPrevious: '&&',
        pipeline: { commands: [{ argv: ['sed', '-n', '1,2p', '/docs/types.txt'] }] },
      },
      {
        relationFromPrevious: '&&',
        pipeline: { commands: [{ argv: ['echo', '--- tests ---'] }] },
      },
      {
        relationFromPrevious: '&&',
        pipeline: { commands: [{ argv: ['grep', '-E', 'cat:|mkdir:|rm:', '/docs/tests.txt'] }] },
      },
    ],
  );
});

test('parseCommandLine rejects trailing operators and empty commands in pipelines', function (): void {
  const invalidInputs = ['a |', 'a &&', 'a | | b'];

  for (const input of invalidInputs) {
    assert.throws(function (): ReturnType<typeof parseCommandLine> {
      return parseCommandLine(input);
    }, ParseError);
  }
});
