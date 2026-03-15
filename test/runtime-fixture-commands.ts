import type { CommandSpec } from '../src/commands/index.js';
import { err, ok, okBytes, type CommandResult } from '../src/types.js';

export type RuntimeFixtureCommandId = 'echo' | 'fail' | 'burst' | 'binary' | 'longline' | 'help-override';

export function runtimeFixtureCommands(ids: readonly RuntimeFixtureCommandId[]): CommandSpec[] {
  return ids.map(function (id) {
    switch (id) {
      case 'echo':
        return {
          name: 'echo',
          summary: 'Echo text.',
          usage: 'echo <text...>',
          details: 'Examples:\n  echo hello',
          async handler(_ctx, args): Promise<CommandResult> {
            return ok(args.join(' '));
          },
        };
      case 'fail':
        return {
          name: 'fail',
          summary: 'Fail immediately.',
          usage: 'fail',
          details: 'Examples:\n  fail',
          async handler(): Promise<CommandResult> {
            return err('fail: forced failure');
          },
        };
      case 'burst':
        return {
          name: 'burst',
          summary: 'Emit three lines.',
          usage: 'burst',
          details: 'Examples:\n  burst',
          async handler(): Promise<CommandResult> {
            return ok('first line\nsecond line\nthird line');
          },
        };
      case 'binary':
        return {
          name: 'binary',
          summary: 'Emit binary bytes.',
          usage: 'binary',
          details: 'Examples:\n  binary',
          async handler(): Promise<CommandResult> {
            return okBytes(Uint8Array.of(0, 1, 2, 3), 'application/octet-stream');
          },
        };
      case 'longline':
        return {
          name: 'longline',
          summary: 'Emit one long line.',
          usage: 'longline',
          details: 'Examples:\n  longline',
          async handler(): Promise<CommandResult> {
            return ok('abcdefghijklmnopqrstuvwxyz');
          },
        };
      case 'help-override':
        return {
          name: 'help',
          summary: 'Overridden help.',
          usage: 'help',
          details: 'Examples:\n  help',
          async handler(): Promise<CommandResult> {
            return ok('override help');
          },
        };
      default: {
        const _never: never = id;
        return _never;
      }
    }
  });
}
