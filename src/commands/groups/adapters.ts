import { err, ok } from '../../types.js';
import { errorMessage } from '../../utils.js';
import type { CommandContext, CommandSpec } from '../core.js';
import { renderFetchPayload } from '../shared/json.js';

async function cmdSearch(ctx: CommandContext, args: string[], stdin: Uint8Array) {
  if (stdin.length > 0) {
    return err('search: does not accept stdin');
  }
  if (args.length === 0) {
    return err('search: usage: search <query>');
  }
  if (!ctx.adapters.search) {
    return err(
      'search: no search adapter configured. Attach one to ToolAdapters(search: yourSearchAdapter).',
    );
  }

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

  return ok(blocks.join('\n\n'));
}

export const search: CommandSpec = {
  name: 'search',
  summary: 'Query your configured search tool and return text results.',
  usage: 'search <query>',
  details: 'Examples:\n  search "refund timeout incident"\n  search "acme renewal risk" | head -n 5',
  handler: cmdSearch,
};

async function cmdFetch(ctx: CommandContext, args: string[], stdin: Uint8Array) {
  if (stdin.length > 0) {
    return err('fetch: does not accept stdin');
  }
  if (args.length !== 1) {
    return err('fetch: usage: fetch <resource>');
  }
  if (!ctx.adapters.fetch) {
    return err(
      'fetch: no fetch adapter configured. Attach one to ToolAdapters(fetch: yourFetchAdapter).',
    );
  }

  try {
    const response = await ctx.adapters.fetch.fetch(args[0]!);
    return renderFetchPayload(response.payload, response.contentType);
  } catch (caught) {
    const message = errorMessage(caught);
    if (message.includes('not found')) {
      return err(`fetch: resource not found: ${args[0]!}`);
    }
    return err(`fetch: adapter error: ${message}`);
  }
}

export const fetch: CommandSpec = {
  name: 'fetch',
  summary: 'Call your configured fetch tool and return text or JSON.',
  usage: 'fetch <resource>',
  details: 'Examples:\n  fetch order:123\n  fetch crm/customer/acme | json get owner.email',
  handler: cmdFetch,
};

export const adapterCommands: CommandSpec[] = [search, fetch];
