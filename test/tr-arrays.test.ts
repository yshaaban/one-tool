import assert from 'node:assert/strict';
import test from 'node:test';

import { compileTrProgram } from '../src/commands/shared/tr-arrays.js';
import { textDecoder, textEncoder } from '../src/types.js';

function runTr(args: string[], input: string | Uint8Array): { stdout?: Uint8Array; error?: string } {
  const compiled = compileTrProgram(args);
  if (!compiled.ok) {
    return { error: compiled.error };
  }

  return {
    stdout: compiled.value.run(typeof input === 'string' ? textEncoder.encode(input) : input),
  };
}

test('compileTrProgram translates, deletes, squeezes, and complements bytes', function (): void {
  assert.equal(textDecoder.decode(runTr(['a-z', 'A-Z'], 'banana').stdout ?? new Uint8Array()), 'BANANA');
  assert.equal(textDecoder.decode(runTr(['-d', '0-9'], 'a1b2c3').stdout ?? new Uint8Array()), 'abc');
  assert.equal(textDecoder.decode(runTr(['-s', ' '], 'a   b').stdout ?? new Uint8Array()), 'a b');
  assert.equal(textDecoder.decode(runTr(['-c', 'a', 'z'], 'ab').stdout ?? new Uint8Array()), 'az');
});

test('compileTrProgram supports octal escapes, ranges, repeats, and case classes', function (): void {
  assert.equal(textDecoder.decode(runTr(['\\012', ' '], 'a\nb').stdout ?? new Uint8Array()), 'a b');
  assert.equal(textDecoder.decode(runTr(['abc', '[x*]'], 'abcabc').stdout ?? new Uint8Array()), 'xxxxxx');
  assert.equal(
    textDecoder.decode(runTr(['[:lower:]', '[:upper:]'], 'abC').stdout ?? new Uint8Array()),
    'ABC',
  );
});

test('compileTrProgram respects truncate-set1 and duplicate set1 overwrite behavior', function (): void {
  assert.equal(textDecoder.decode(runTr(['-t', 'abcd', 'xy'], 'abcd').stdout ?? new Uint8Array()), 'xycd');
  assert.equal(textDecoder.decode(runTr(['aa', 'zq'], 'aab').stdout ?? new Uint8Array()), 'qqb');
});

test('compileTrProgram reports GNU-compatible operand and class alignment errors', function (): void {
  assert.match(runTr(['a', ''], '').error ?? '', /string2 must be non-empty/);
  assert.match(runTr(['0-9', '[:upper:]'], '').error ?? '', /misaligned \[:upper:\]/);
  assert.match(runTr(['-d', '0-9', 'abc'], '').error ?? '', /Only one string may be given when deleting/);
  assert.match(runTr(['z-a', 'A-Z'], '').error ?? '', /invalid descending range/);
});
