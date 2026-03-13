import type { CommandResult } from '../../types.js';
import { err, ok, okBytes, textEncoder } from '../../types.js';
import { formatMaterializedLimitMessage } from '../../execution-policy.js';
import { errorMessage } from '../../utils.js';
import type { CommandContext } from '../core.js';
import { readTextFromFileOrStdin } from './io.js';

export async function loadJson(
  ctx: CommandContext,
  filePath: string | undefined,
  stdin: Uint8Array,
  commandName: string,
): Promise<{ value?: unknown; error?: CommandResult }> {
  const { text, error } = await readTextFromFileOrStdin(ctx, filePath, stdin, commandName);
  if (error) {
    return { error };
  }
  try {
    return { value: JSON.parse(text ?? '') };
  } catch (caught) {
    return { error: err(`${commandName}: invalid JSON: ${errorMessage(caught)}`) };
  }
}

export function extractJsonPath(value: unknown, pathExpression: string): unknown {
  if (!pathExpression) {
    return value;
  }

  const tokens: Array<string | number> = [];

  for (const segment of pathExpression.split('.')) {
    if (!segment) {
      continue;
    }

    let cursor = 0;
    while (cursor < segment.length) {
      if (segment[cursor] === '[') {
        const end = segment.indexOf(']', cursor);
        if (end === -1) {
          throw new Error(`malformed path segment: ${segment}`);
        }
        const indexText = segment.slice(cursor + 1, end);
        tokens.push(Number.parseInt(indexText, 10));
        cursor = end + 1;
      } else {
        let end = cursor;
        while (end < segment.length && segment[end] !== '[') {
          end += 1;
        }
        tokens.push(segment.slice(cursor, end));
        cursor = end;
      }
    }
  }

  let current: unknown = value;
  for (const token of tokens) {
    if (typeof token === 'number') {
      if (!Array.isArray(current)) {
        throw new Error(String(token));
      }
      current = current[token];
      continue;
    }

    if (typeof current !== 'object' || current === null || !(token in current)) {
      throw new Error(token);
    }
    current = (current as Record<string, unknown>)[token];
  }

  return current;
}

interface RenderFetchPayloadOptions {
  commandName?: string;
  subject?: string;
  maxMaterializedBytes?: number;
}

export function renderFetchPayload(
  payload: unknown,
  contentType: string,
  options: RenderFetchPayloadOptions = {},
): CommandResult {
  const commandName = options.commandName ?? 'fetch';
  const subject = options.subject ?? 'resource';

  if (payload instanceof Uint8Array) {
    const limitError = materializedPayloadLimitError(
      commandName,
      subject,
      payload.length,
      options.maxMaterializedBytes,
    );
    if (limitError !== undefined) {
      return limitError;
    }
    return okBytes(payload, contentType);
  }
  if (typeof payload === 'object' && payload !== null) {
    const rendered = JSON.stringify(payload, null, 2);
    const limitError = materializedPayloadLimitError(
      commandName,
      subject,
      textEncoder.encode(rendered).length,
      options.maxMaterializedBytes,
    );
    if (limitError !== undefined) {
      return limitError;
    }
    return ok(rendered, { contentType: 'application/json' });
  }
  const rendered = String(payload ?? 'null');
  const limitError = materializedPayloadLimitError(
    commandName,
    subject,
    textEncoder.encode(rendered).length,
    options.maxMaterializedBytes,
  );
  if (limitError !== undefined) {
    return limitError;
  }
  return ok(rendered, { contentType });
}

function materializedPayloadLimitError(
  commandName: string,
  subject: string,
  actualBytes: number,
  maxMaterializedBytes: number | undefined,
): CommandResult | undefined {
  if (maxMaterializedBytes === undefined || actualBytes <= maxMaterializedBytes) {
    return undefined;
  }

  return err(formatMaterializedLimitMessage(commandName, subject, actualBytes, maxMaterializedBytes));
}
