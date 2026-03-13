import type { CommandResult } from '../types.js';

export type HelperResult<T> = { ok: true; value: T } | { ok: false; error: CommandResult };

export function helperSuccess<T>(value: T): HelperResult<T> {
  return { ok: true, value };
}

export function helperFailure<T>(error: CommandResult): HelperResult<T> {
  return { ok: false, error };
}
