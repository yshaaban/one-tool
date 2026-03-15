import type { CommandSnapshotCase } from './snapshot-cases.js';
import { snapshotDir } from './snapshot-cases.js';

const textEncoder = new TextEncoder();

function encodeText(value: string): Uint8Array {
  return textEncoder.encode(value);
}

export const INVALID_COMMAND_CASES: CommandSnapshotCase[] = [
  {
    id: 'invalid-cat-binary-stdin',
    commandName: 'cat',
    args: ['-'],
    stdin: Uint8Array.of(0, 1, 2, 3),
  },
  {
    id: 'invalid-append-resource-limit',
    commandName: 'append',
    args: ['/notes/log.txt', '!'],
    world: {
      files: {
        '/notes/log.txt': 'abc',
      },
    },
    vfsResourcePolicy: {
      maxFileBytes: 3,
    },
  },
  {
    id: 'invalid-append-directory-target',
    commandName: 'append',
    args: ['/notes', 'next'],
    world: {
      files: {
        '/notes': snapshotDir(),
      },
    },
  },
  {
    id: 'invalid-grep-recursive-option',
    commandName: 'grep',
    args: ['-R', 'ERROR', '/logs'],
  },
  {
    id: 'invalid-find-print0-option',
    commandName: 'find',
    args: ['/tree', '-print0'],
  },
  {
    id: 'invalid-diff-context-count',
    commandName: 'diff',
    args: ['-C', 'nope', '/left.txt', '/right.txt'],
    world: {
      files: {
        '/left.txt': 'left\n',
        '/right.txt': 'right\n',
      },
    },
  },
  {
    id: 'invalid-json-binary-stdin',
    commandName: 'json',
    args: ['pretty'],
    stdin: Uint8Array.of(0, 1, 2, 3),
  },
  {
    id: 'invalid-json-keys-non-object',
    commandName: 'json',
    args: ['keys'],
    stdin: encodeText('["alpha","beta"]'),
  },
  {
    id: 'invalid-sed-inplace-requires-file',
    commandName: 'sed',
    args: ['-i', 's/a/b/'],
  },
  {
    id: 'invalid-sed-inplace-stdin-marker',
    commandName: 'sed',
    args: ['-i', 's/a/b/', '-'],
    stdin: encodeText('a\n'),
  },
  {
    id: 'invalid-sed-missing-script-for-e',
    commandName: 'sed',
    args: ['-e'],
  },
  {
    id: 'invalid-sed-missing-script-file-for-f',
    commandName: 'sed',
    args: ['-f'],
  },
  {
    id: 'invalid-sed-unterminated-substitute-pattern',
    commandName: 'sed',
    args: ['s/a'],
    stdin: encodeText('a\n'),
  },
  {
    id: 'invalid-sed-unsupported-substitute-flag',
    commandName: 'sed',
    args: ['s/a/b/w'],
    stdin: encodeText('a\n'),
  },
  {
    id: 'invalid-tr-descending-range',
    commandName: 'tr',
    args: ['z-a', 'A-Z'],
    stdin: encodeText('abc\n'),
  },
];
