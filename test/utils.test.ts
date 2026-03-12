import assert from 'node:assert/strict';
import test from 'node:test';

import {
  errorMessage,
  formatDuration,
  formatSize,
  isPlainObject,
  looksBinary,
  parentPath,
  safeEvalArithmetic,
  splitLines,
  tokenizeForSearch,
} from '../src/utils.js';

const textEncoder = new TextEncoder();

test('errorMessage formats errors, strings, and objects', function (): void {
  assert.equal(errorMessage(new Error('boom')), 'boom');
  assert.equal(errorMessage('plain failure'), 'plain failure');
  assert.equal(errorMessage({ reason: 'unknown' }), '[object Object]');
});

test('splitLines handles empty strings and line endings consistently', function (): void {
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines('alpha'), ['alpha']);
  assert.deepEqual(splitLines('alpha\nbeta'), ['alpha', 'beta']);
  assert.deepEqual(splitLines('alpha\nbeta\n'), ['alpha', 'beta']);
  assert.deepEqual(splitLines('alpha\r\nbeta\r\n'), ['alpha', 'beta']);
  assert.deepEqual(splitLines('alpha\rbeta\r'), ['alpha', 'beta']);
});

test('formatDuration renders milliseconds, seconds, and minutes', function (): void {
  assert.equal(formatDuration(999), '999ms');
  assert.equal(formatDuration(1000), '1.0s');
  assert.equal(formatDuration(1550), '1.6s');
  assert.equal(formatDuration(61_000), '1m1.0s');
});

test('formatSize renders byte units at key boundaries', function (): void {
  assert.equal(formatSize(0), '0B');
  assert.equal(formatSize(1023), '1023B');
  assert.equal(formatSize(1024), '1.0KB');
  assert.equal(formatSize(1536), '1.5KB');
  assert.equal(formatSize(1024 ** 2), '1.0MB');
  assert.equal(formatSize(1024 ** 3), '1.0GB');
});

test('tokenizeForSearch normalizes words, numbers, and underscores', function (): void {
  assert.deepEqual([...tokenizeForSearch('Hello WORLD_2 42 hello')].sort(), ['42', 'hello', 'world_2']);
  assert.deepEqual([...tokenizeForSearch('')], []);
});

test('looksBinary detects null bytes, invalid utf8, and control-heavy payloads', function (): void {
  assert.equal(looksBinary(new Uint8Array()), false);
  assert.equal(looksBinary(Uint8Array.from([65, 0, 66])), true);
  assert.equal(looksBinary(textEncoder.encode('hello\nworld')), false);
  assert.equal(looksBinary(Uint8Array.from([0xff, 0xfe, 0xfd])), true);
  assert.equal(looksBinary(Uint8Array.from([1, 2, 3, 65, 66, 67, 68, 69, 70])), true);
});

test('safeEvalArithmetic handles supported operators and precedence', function (): void {
  assert.equal(safeEvalArithmetic('1 + 2 * 3'), 7);
  assert.equal(safeEvalArithmetic('(1 + 2) * 3'), 9);
  assert.equal(safeEvalArithmetic('2 ** 3 ** 2'), 512);
  assert.equal(safeEvalArithmetic('7 // 2'), 3);
  assert.equal(safeEvalArithmetic('7 % 4'), 3);
  assert.equal(safeEvalArithmetic('-3 + 5'), 2);
});

test('safeEvalArithmetic rejects empty input, invalid characters, and non-finite results', function (): void {
  assert.throws(function (): number {
    return safeEvalArithmetic('');
  }, /empty expression/);
  assert.throws(function (): number {
    return safeEvalArithmetic('2 + abc');
  }, /unsupported character/);
  assert.throws(function (): number {
    return safeEvalArithmetic('1 / 0');
  }, /result is not finite/);
});

test('isPlainObject distinguishes plain objects from other values', function (): void {
  class Example {}

  assert.equal(isPlainObject({ a: 1 }), true);
  assert.equal(isPlainObject([]), false);
  assert.equal(isPlainObject(null), false);
  assert.equal(isPlainObject(new Example()), false);
  assert.equal(isPlainObject(Object.create(null)), true);
});

test('parentPath normalizes dot segments and clamps at root', function (): void {
  assert.equal(parentPath('/'), '/');
  assert.equal(parentPath('/foo'), '/');
  assert.equal(parentPath('/foo/bar'), '/foo');
  assert.equal(parentPath('/foo/bar/'), '/foo');
  assert.equal(parentPath('foo/bar'), '/foo');
  assert.equal(parentPath('./foo/bar'), '/foo');
  assert.equal(parentPath('foo/./bar'), '/foo');
  assert.equal(parentPath('//foo//bar//'), '/foo');
  assert.equal(parentPath('/foo/./bar'), '/foo');
  assert.equal(parentPath('/foo//bar///'), '/foo');
  assert.equal(parentPath('/foo/bar/..'), '/');
  assert.equal(parentPath('/foo/../bar'), '/');
  assert.equal(parentPath('/../../etc/passwd'), '/etc');
  assert.equal(parentPath('/../..'), '/');
});
