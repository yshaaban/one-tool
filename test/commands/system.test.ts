import assert from 'node:assert/strict';
import test from 'node:test';

import { makeRegistry, makeCtx, runCommand, stdinText, stdoutText } from './harness.js';

test('system: registerBuiltinCommands registers the expected command names once', () => {
  const registry = makeRegistry();
  assert.deepEqual(registry.names(), [
    'append',
    'calc',
    'cat',
    'cp',
    'diff',
    'echo',
    'fetch',
    'find',
    'grep',
    'head',
    'help',
    'json',
    'ls',
    'memory',
    'mkdir',
    'mv',
    'rm',
    'search',
    'sed',
    'sort',
    'stat',
    'tail',
    'tr',
    'uniq',
    'wc',
    'write',
  ]);
});

test('system: help lists commands and renders detailed command help', async () => {
  const list = await runCommand('help');
  assert.equal(list.result.exitCode, 0);
  assert.match(stdoutText(list.result), /Available commands:/);
  assert.match(stdoutText(list.result), /grep\s+— Filter lines by pattern/);

  const detail = await runCommand('help', ['grep'], { ctx: list.ctx });
  assert.equal(detail.result.exitCode, 0);
  assert.match(
    stdoutText(detail.result),
    /Usage: grep \[-i\] \[-v\] \[-c\] \[-n\] \[-F\] \[-E\] \[-o\] \[-w\] \[-x\] \[-q\] <pattern> \[path\]/,
  );
});

test('system: help reports unknown commands and rejects stdin', async () => {
  const unknown = await runCommand('help', ['nope']);
  assert.equal(unknown.result.exitCode, 1);
  assert.match(unknown.result.stderr, /help: unknown command: nope/);

  const stdin = await runCommand('help', [], { stdin: stdinText('ignored') });
  assert.equal(stdin.result.exitCode, 1);
  assert.match(stdin.result.stderr, /help: does not accept stdin/);
});

test('system: memory stores inline and stdin content, then returns recent items', async () => {
  const ctx = makeCtx();

  const inline = await runCommand('memory', ['store', 'Acme', 'prefers', 'Monday'], { ctx });
  assert.equal(inline.result.exitCode, 0);
  assert.match(stdoutText(inline.result), /stored memory #1/);

  const piped = await runCommand('memory', ['store'], {
    ctx,
    stdin: stdinText('Escalate checkout timeouts'),
  });
  assert.equal(piped.result.exitCode, 0);
  assert.match(stdoutText(piped.result), /stored memory #2/);

  const recent = await runCommand('memory', ['recent', '2'], { ctx });
  assert.equal(recent.result.exitCode, 0);
  assert.equal(stdoutText(recent.result), '#2  Escalate checkout timeouts\n#1  Acme prefers Monday');
});

test('system: memory validates recent arguments and supports search', async () => {
  const ctx = makeCtx();
  await runCommand('memory', ['store', 'Acme follow-up next Monday'], { ctx });
  await runCommand('memory', ['store', 'Escalate payment timeout issue'], { ctx });

  const invalidRecent = await runCommand('memory', ['recent', 'NaN'], { ctx });
  assert.equal(invalidRecent.result.exitCode, 1);
  assert.match(invalidRecent.result.stderr, /memory recent: invalid integer: NaN/);

  const inlineSearch = await runCommand('memory', ['search', 'Acme'], { ctx });
  assert.equal(inlineSearch.result.exitCode, 0);
  assert.match(stdoutText(inlineSearch.result), /Acme follow-up next Monday/);

  const stdinSearch = await runCommand('memory', ['search'], {
    ctx,
    stdin: stdinText('payment timeout'),
  });
  assert.equal(stdinSearch.result.exitCode, 0);
  assert.match(stdoutText(stdinSearch.result), /Escalate payment timeout issue/);
});

test('system: memory reports usage errors and unknown subcommands', async () => {
  const missingStore = await runCommand('memory', ['store']);
  assert.equal(missingStore.result.exitCode, 1);
  assert.match(missingStore.result.stderr, /memory store: provide text inline or via stdin/);

  const missingSearch = await runCommand('memory', ['search']);
  assert.equal(missingSearch.result.exitCode, 1);
  assert.match(missingSearch.result.stderr, /memory search: usage: memory search <query>/);

  const unknown = await runCommand('memory', ['purge']);
  assert.equal(unknown.result.exitCode, 1);
  assert.match(unknown.result.stderr, /memory: unknown subcommand/);
});
