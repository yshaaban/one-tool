import assert from 'node:assert/strict';
import test from 'node:test';

import { createByteLineModel, decodeCLocaleText } from '../src/commands/shared/line-model.js';

test('createByteLineModel handles empty content', function (): void {
  const model = createByteLineModel(new Uint8Array());

  assert.equal(model.lines.length, 0);
  assert.equal(model.endsWithNewline, false);
  assert.equal(model.byteLength, 0);
});

test('createByteLineModel tracks trailing newlines without normalizing carriage returns', function (): void {
  const model = createByteLineModel(new Uint8Array([97, 13, 10, 98, 13, 10]));

  assert.equal(model.endsWithNewline, true);
  assert.equal(model.lines.length, 2);
  assert.equal(model.lines[0]?.text, 'a\r');
  assert.equal(model.lines[1]?.text, 'b\r');
});

test('createByteLineModel preserves a final unterminated line', function (): void {
  const model = createByteLineModel(new Uint8Array([97, 10, 98]));

  assert.equal(model.endsWithNewline, false);
  assert.equal(model.lines.length, 2);
  assert.equal(model.lines[0]?.text, 'a');
  assert.equal(model.lines[1]?.text, 'b');
});

test('createByteLineModel preserves explicit empty lines before a trailing newline', function (): void {
  const model = createByteLineModel(new Uint8Array([10, 10]));

  assert.equal(model.endsWithNewline, true);
  assert.equal(model.byteLength, 2);
  assert.equal(model.lines.length, 2);
  assert.deepEqual(
    model.lines.map(function (line) {
      return Array.from(line.bytes);
    }),
    [[], []],
  );
});

test('decodeCLocaleText preserves single-byte data without utf8 decoding rules', function (): void {
  const decoded = decodeCLocaleText(new Uint8Array([0, 255, 65]));

  assert.equal(decoded.length, 3);
  assert.equal(decoded.charCodeAt(0), 0);
  assert.equal(decoded.charCodeAt(1), 255);
  assert.equal(decoded.charCodeAt(2), 65);
});
