import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { MemoryVFS } from 'one-tool';
import { createMcpServer, serveStdioMcpServer } from 'one-tool/mcp';

import { buildDemoRuntime } from '../demo-runtime.js';
import {
  createExampleIO,
  getExampleArgs,
  printHeading,
  runIfEntrypointWithErrorHandling,
  type ExampleRunOptions,
} from '../shared/example-utils.js';

export async function main(options: ExampleRunOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const args = getExampleArgs(options);
  const selfTest = args.includes('--self-test');

  if (selfTest) {
    await runSelfTest(io);
    return;
  }

  const runtime = await buildDemoRuntime();
  await runtime.initialize();
  await serveStdioMcpServer(runtime, {
    instructions: 'Use the run tool to execute one-tool commands against the rooted virtual workspace.',
  });

  if (!options.quiet) {
    console.error('Serving one-tool over MCP stdio.');
    console.error('Point Claude Code or another MCP client at this process.');
  }

  await new Promise<void>(function () {});
}

async function runSelfTest(io: ReturnType<typeof createExampleIO>): Promise<void> {
  const runtime = await buildDemoRuntime({ vfs: new MemoryVFS() });
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
        command: 'grep -c ERROR /logs/app.log',
      },
    })) as CallToolResult;
    const text = getTextContent(result);

    printHeading(
      io,
      'Reference: MCP stdio server',
      'This sample exposes one-tool as a single MCP tool named run(command).',
    );
    io.write(`Registered tools: ${tools.tools.map((tool) => tool.name).join(', ')}`);
    io.write(`Self-test result: ${text.split('\n')[0] ?? '(empty)'}`);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
}

function getTextContent(result: CallToolResult): string {
  const content = result.content[0];
  return content?.type === 'text' ? content.text : '';
}

await runIfEntrypointWithErrorHandling(import.meta.url, main);
