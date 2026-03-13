import { err } from '../types.js';
import { helperFailure, helperSuccess, type HelperResult } from './types.js';

export interface ParsedCountFlag {
  count: number;
  rest: string[];
}

export function parseCountFlag(
  commandName: string,
  args: string[],
  defaultCount: number,
): HelperResult<ParsedCountFlag> {
  if (args[0] !== '-n') {
    return helperSuccess({
      count: defaultCount,
      rest: [...args],
    });
  }

  if (args.length < 2) {
    return helperFailure(err(`${commandName}: missing value for -n`));
  }

  const count = Number.parseInt(args[1] ?? '', 10);
  if (!Number.isFinite(count)) {
    return helperFailure(err(`${commandName}: invalid integer for -n: ${args[1]}`));
  }

  return helperSuccess({
    count,
    rest: args.slice(2),
  });
}
