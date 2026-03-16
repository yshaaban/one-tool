import { err, ok } from '../../types.js';
import { compareCLocaleText, errorMessage, safeEvalArithmetic } from '../../utils.js';
import type { CommandContext, CommandSpec } from '../core.js';
import { extractJsonPath, loadJson } from '../shared/json.js';

async function cmdJson(ctx: CommandContext, args: string[], stdin: Uint8Array) {
  if (args.length === 0) {
    return err('json: usage: json pretty [path] | json keys [path] | json get <field.path> [path]');
  }

  const sub = args[0]!;

  if (sub === 'pretty') {
    const filePath = args[1];
    if (args.length > 2) {
      return err('json: usage: json pretty [path]');
    }
    const { value, error } = await loadJson(ctx, filePath, stdin, 'json pretty');
    if (error) {
      return error;
    }
    return ok(JSON.stringify(value, null, 2), { contentType: 'application/json' });
  }

  if (sub === 'keys') {
    const filePath = args[1];
    if (args.length > 2) {
      return err('json: usage: json keys [path]');
    }
    const { value, error } = await loadJson(ctx, filePath, stdin, 'json keys');
    if (error) {
      return error;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return err('json keys: input must be a JSON object');
    }
    return ok(
      Object.keys(value as Record<string, unknown>)
        .sort(compareCLocaleText)
        .join('\n'),
    );
  }

  if (sub === 'get') {
    if (args.length < 2 || args.length > 3) {
      return err('json: usage: json get <field.path> [path]');
    }
    const pathExpression = args[1]!;
    const filePath = args[2];
    const { value, error } = await loadJson(ctx, filePath, stdin, 'json get');
    if (error) {
      return error;
    }
    try {
      const extracted = extractJsonPath(value, pathExpression);
      if (Array.isArray(extracted) || (typeof extracted === 'object' && extracted !== null)) {
        return ok(JSON.stringify(extracted, null, 2), { contentType: 'application/json' });
      }
      return ok(String(extracted));
    } catch (caught) {
      return err(`json get: path not found: ${pathExpression} (${errorMessage(caught)})`);
    }
  }

  return err('json: unknown subcommand. Use: json pretty | json keys | json get');
}

export const json: CommandSpec = {
  name: 'json',
  summary: 'Inspect JSON from stdin or a file: pretty, keys, get.',
  usage: 'json pretty [path] | json keys [path] | json get <field.path> [path]',
  details:
    'Uses a small dot-and-index path syntax such as customer.email or items[0].id. It is not jq.\nExamples:\n  fetch order:123 | json pretty\n  fetch order:123 | json get customer.email\n  json keys /config/default.json',
  handler: cmdJson,
  acceptsStdin: true,
  minArgs: 1,
  conformanceArgs: ['pretty'],
};

async function cmdCalc(_ctx: CommandContext, args: string[], stdin: Uint8Array) {
  if (stdin.length > 0) {
    return err('calc: does not accept stdin');
  }
  if (args.length === 0) {
    return err('calc: usage: calc <expression>');
  }

  try {
    const value = safeEvalArithmetic(args.join(' '));
    return ok(String(value));
  } catch (caught) {
    return err(`calc: invalid expression: ${errorMessage(caught)}`);
  }
}

export const calc: CommandSpec = {
  name: 'calc',
  summary: 'Evaluate a safe arithmetic expression.',
  usage: 'calc <expression>',
  details:
    'Supports numbers, parentheses, and the operators +, -, *, /, and %.\nExamples:\n  calc 41 + 1\n  calc (12 * 8) / 3',
  handler: cmdCalc,
  acceptsStdin: false,
  minArgs: 1,
  conformanceArgs: ['1+1'],
};

export const dataCommands: CommandSpec[] = [json, calc];
