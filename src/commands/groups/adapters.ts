import { err, ok, okBytes, textEncoder, type CommandResult } from '../../types.js';
import { errorMessage } from '../../utils.js';
import type { CommandContext, CommandSpec } from '../core.js';
import { errorCode } from '../shared/errors.js';
import { renderFetchPayload } from '../shared/json.js';
import { materializedLimitError } from '../shared/io.js';

function configuredAdapterMessage(commandName: 'search' | 'fetch'): string {
  return `${commandName}: no ${commandName} adapter configured. Pass { adapters: { ${commandName}: ... } } to createAgentCLI(...) to use this command.`;
}

function errorStatusCode(caught: unknown): number | null {
  if (!caught || typeof caught !== 'object') {
    return null;
  }

  if ('status' in caught && typeof (caught as { status?: unknown }).status === 'number') {
    return (caught as { status: number }).status;
  }
  if ('statusCode' in caught && typeof (caught as { statusCode?: unknown }).statusCode === 'number') {
    return (caught as { statusCode: number }).statusCode;
  }

  return null;
}

function isFetchNotFoundError(caught: unknown): boolean {
  const code = errorCode(caught);
  if (code === 'ENOENT' || code === 'NOT_FOUND') {
    return true;
  }

  if (errorStatusCode(caught) === 404) {
    return true;
  }

  return /\bnot found\b/i.test(errorMessage(caught));
}

async function cmdSearch(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return err('search: does not accept stdin');
  }
  if (args.length === 0) {
    return err('search: usage: search <query>');
  }
  if (!ctx.adapters.search) {
    return err(configuredAdapterMessage('search'));
  }

  try {
    const hits = await ctx.adapters.search.search(args.join(' '), 10);
    if (hits.length === 0) {
      return ok('(no results)');
    }

    const blocks = hits.map((hit, index) => {
      const lines = [`${index + 1}. ${hit.title}`];
      if (hit.source) {
        lines.push(`   source: ${hit.source}`);
      }
      if (hit.snippet) {
        lines.push(`   ${hit.snippet}`);
      }
      return lines.join('\n');
    });

    const rendered = blocks.join('\n\n');
    const renderedBytes = textEncoder.encode(rendered);
    const limitError = materializedLimitError(ctx, 'search', 'search results', renderedBytes.length);
    if (limitError !== undefined) {
      return limitError;
    }

    return okBytes(renderedBytes, 'text/plain');
  } catch (caught) {
    return err(`search: adapter error: ${errorMessage(caught)}`);
  }
}

export const search: CommandSpec = {
  name: 'search',
  summary: 'Query your configured search tool and return text results.',
  usage: 'search <query>',
  details:
    'Ranking and recall come from the configured adapter. This command formats the top results for the runtime.\nExamples:\n  search "refund timeout incident"\n  search "acme renewal risk" | head -n 5',
  handler: cmdSearch,
  acceptsStdin: false,
  minArgs: 1,
  requiresAdapter: 'search',
  conformanceArgs: ['query'],
};

async function cmdFetch(ctx: CommandContext, args: string[], stdin: Uint8Array): Promise<CommandResult> {
  if (stdin.length > 0) {
    return err('fetch: does not accept stdin');
  }
  if (args.length !== 1) {
    return err('fetch: usage: fetch <resource>');
  }
  if (!ctx.adapters.fetch) {
    return err(configuredAdapterMessage('fetch'));
  }

  try {
    const response = await ctx.adapters.fetch.fetch(args[0]!);
    return renderFetchPayload(response.payload, response.contentType, {
      commandName: 'fetch',
      subject: args[0]!,
      ...(ctx.executionPolicy.maxMaterializedBytes === undefined
        ? {}
        : { maxMaterializedBytes: ctx.executionPolicy.maxMaterializedBytes }),
    });
  } catch (caught) {
    const message = errorMessage(caught);
    if (isFetchNotFoundError(caught)) {
      return err(`fetch: resource not found: ${args[0]!}`);
    }
    return err(`fetch: adapter error: ${message}`);
  }
}

export const fetch: CommandSpec = {
  name: 'fetch',
  summary: 'Call your configured fetch tool and return text or JSON.',
  usage: 'fetch <resource>',
  details:
    'Resource identifiers and payloads come from the configured adapter. This command renders the returned text, JSON, or bytes for the runtime.\nExamples:\n  fetch order:123\n  fetch crm/customer/acme | json get owner.email',
  handler: cmdFetch,
  acceptsStdin: false,
  minArgs: 1,
  maxArgs: 1,
  requiresAdapter: 'fetch',
  conformanceArgs: ['res:1'],
};

export const adapterCommands: CommandSpec[] = [search, fetch];
