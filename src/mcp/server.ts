import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  ErrorCode,
  ListToolsRequestSchema,
  CallToolRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import type { AgentCLI, RunExecution, ToolDescriptionVariant } from '../runtime.js';
import { buildToolDefinition } from '../tool-schema.js';

export interface McpServerOptions {
  serverName?: string;
  serverVersion?: string;
  instructions?: string;
  toolName?: string;
  descriptionVariant?: ToolDescriptionVariant;
}

export interface ConnectedMcpServer {
  server: Server;
  transport: StdioServerTransport;
  close(): Promise<void>;
}

const DEFAULT_SERVER_NAME = 'one-tool';
const DEFAULT_SERVER_VERSION = process.env.npm_package_version ?? '0.1.0';

export function createMcpServer(runtime: AgentCLI, options: McpServerOptions = {}): Server {
  const toolName = options.toolName ?? 'run';
  const tool = buildToolDefinition(runtime, toolName, {
    ...(options.descriptionVariant === undefined ? {} : { descriptionVariant: options.descriptionVariant }),
  });

  const server = new Server(
    {
      name: options.serverName ?? DEFAULT_SERVER_NAME,
      version: options.serverVersion ?? DEFAULT_SERVER_VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
      ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async function () {
    return {
      tools: [
        {
          name: tool.function.name,
          description: tool.function.description,
          inputSchema: tool.function.parameters,
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async function (request) {
    if (request.params.name !== tool.function.name) {
      throw new McpError(ErrorCode.MethodNotFound, `unknown tool: ${request.params.name}`);
    }

    const command = request.params.arguments?.command;
    if (typeof command !== 'string' || command.trim().length === 0) {
      throw new McpError(ErrorCode.InvalidParams, 'tools/call requires a string command argument');
    }

    const execution = await runtime.runDetailed(command);
    return buildCallToolResult(execution);
  });

  return server;
}

export async function serveStdioMcpServer(
  runtime: AgentCLI,
  options: McpServerOptions = {},
): Promise<ConnectedMcpServer> {
  await runtime.initialize();
  const server = createMcpServer(runtime, options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return {
    server,
    transport,
    close(): Promise<void> {
      return server.close();
    },
  };
}

function buildCallToolResult(execution: RunExecution) {
  return {
    content: [
      {
        type: 'text' as const,
        text: execution.presentation.text,
      },
    ],
    structuredContent: {
      commandLine: execution.commandLine,
      exitCode: execution.exitCode,
      durationMs: execution.durationMs,
      contentType: execution.contentType,
      stderr: execution.stderr,
      stdoutMode: execution.presentation.stdoutMode,
      savedPath: execution.presentation.savedPath ?? null,
      totalBytes: execution.presentation.totalBytes ?? null,
      totalLines: execution.presentation.totalLines ?? null,
      trace: execution.trace,
    },
    isError: execution.exitCode !== 0,
  };
}
