import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { MemoryVFS } from 'one-tool';
import { createMcpServer, serveStdioMcpServer } from 'one-tool/mcp';
import { buildDemoRuntime } from 'one-tool/testing';

import {
  createExampleIO,
  getExampleArgs,
  runIfEntrypointWithErrorHandling,
  type ExampleOptions,
} from './_example-utils.js';

async function buildSelfTestRuntime() {
  return buildDemoRuntime({ vfs: new MemoryVFS() });
}

async function buildStdioRuntime() {
  return buildDemoRuntime();
}

function getTextContent(result: CallToolResult): string {
  const first = result.content[0];
  return first?.type === 'text' ? first.text : '';
}

async function runSelfTest(io: ReturnType<typeof createExampleIO>): Promise<void> {
  const runtime = await buildSelfTestRuntime();
  const server = createMcpServer(runtime, {
    descriptionVariant: 'minimal-tool-description',
  });
  const client = new Client({
    name: 'one-tool-example-self-test',
    version: '1.0.0',
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const tools = await client.listTools();
    const result = (await client.callTool({
      name: 'run',
      arguments: {
        command: 'fetch order:123 | json get customer.email',
      },
    })) as CallToolResult;

    io.write('07 · MCP server');
    io.write('Expose one-tool as a single MCP tool for Claude Code or any MCP client.');
    io.write(`Registered tools: ${tools.tools.map((tool) => tool.name).join(', ')}`);
    io.write(`Self-test result: ${getTextContent(result).split('\n')[0] ?? '(empty)'}`);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

export async function main(options: ExampleOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const args = getExampleArgs(options);

  if (args.includes('--self-test')) {
    await runSelfTest(io);
    return;
  }

  const runtime = await buildStdioRuntime();
  await runtime.initialize();
  await serveStdioMcpServer(runtime, {
    instructions: 'Use the run tool to execute one-tool commands against the rooted workspace.',
  });

  if (!options.quiet) {
    console.error('Serving one-tool over MCP stdio.');
  }

  await new Promise<void>(function () {});
}

await runIfEntrypointWithErrorHandling(import.meta.url, main);
