import assert from 'node:assert/strict';
import test from 'node:test';

import { parentPath } from '../src/utils.js';

test('parentPath preserves current normalization behavior', () => {
  assert.equal(parentPath('/'), '/');
  assert.equal(parentPath('/foo'), '/');
  assert.equal(parentPath('/foo/bar'), '/foo');
  assert.equal(parentPath('/foo/bar/'), '/foo');
  assert.equal(parentPath('foo/bar'), '/foo');
  assert.equal(parentPath('./foo/bar'), '/./foo');
  assert.equal(parentPath('foo/./bar'), '/foo/.');
  assert.equal(parentPath('//foo//bar//'), '/foo');
  assert.equal(parentPath('/foo/./bar'), '/foo/.');
  assert.equal(parentPath('/foo//bar///'), '/foo');
  assert.equal(parentPath('/foo/bar/..'), '/foo/bar');
  assert.equal(parentPath('/foo/../bar'), '/foo/..');
  assert.equal(parentPath('/../../etc/passwd'), '/../../etc');
  assert.equal(parentPath('/../..'), '/..');
});
