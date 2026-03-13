import assert from 'node:assert/strict';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

import { buildDemoRuntime } from '../examples/demo-runtime.js';
import { MemoryVFS } from '../src/index.js';
import { createMcpServer } from '../src/mcp/index.js';

interface ExecutionSummary {
  exitCode?: unknown;
  stdoutMode?: unknown;
  trace?: unknown;
}

function getTextContent(result: CallToolResult): string {
  const content = result.content[0];
  return content?.type === 'text' ? content.text : '';
}

function getStructuredContent(result: CallToolResult): ExecutionSummary {
  return (result.structuredContent ?? {}) as ExecutionSummary;
}

test('createMcpServer exposes a single run tool with the runtime description', async function (): Promise<void> {
  const runtime = await buildDemoRuntime({ vfs: new MemoryVFS() });
  const server = createMcpServer(runtime, {
    descriptionVariant: 'minimal-tool-description',
  });
  const client = new Client({
    name: 'one-tool-mcp-test',
    version: '1.0.0',
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 1);
    assert.equal(tools.tools[0]?.name, 'run');
    assert.equal(tools.tools[0]?.description, runtime.buildToolDescription('minimal-tool-description'));
    assert.equal(tools.tools[0]?.inputSchema.type, 'object');
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});

test('createMcpServer executes run calls and returns structured execution metadata', async function (): Promise<void> {
  const runtime = await buildDemoRuntime({ vfs: new MemoryVFS() });
  const server = createMcpServer(runtime);
  const client = new Client({
    name: 'one-tool-mcp-test',
    version: '1.0.0',
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const result = (await client.callTool({
      name: 'run',
      arguments: {
        command: 'grep -c ERROR /logs/app.log',
      },
    })) as CallToolResult;
    const structuredContent = getStructuredContent(result);
    assert.match(getTextContent(result), /^3\b/m);
    assert.equal(result.isError, false);
    assert.equal(structuredContent.exitCode, 0);
    assert.equal(structuredContent.stdoutMode, 'plain');
    assert.equal(Array.isArray(structuredContent.trace), true);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});

test('createMcpServer marks failed command executions as tool errors', async function (): Promise<void> {
  const runtime = await buildDemoRuntime({ vfs: new MemoryVFS() });
  const server = createMcpServer(runtime);
  const client = new Client({
    name: 'one-tool-mcp-test',
    version: '1.0.0',
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const result = (await client.callTool({
      name: 'run',
      arguments: {
        command: 'missingcmd arg',
      },
    })) as CallToolResult;
    const structuredContent = getStructuredContent(result);
    assert.equal(result.isError, true);
    assert.equal(structuredContent.exitCode, 127);
    assert.match(getTextContent(result), /unknown command: missingcmd/);
  } finally {
    await Promise.all([client.close(), server.close()]);
  }
});
