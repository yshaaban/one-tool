import { createServer, type Server } from 'node:http';
import process from 'node:process';

import { buildToolDefinition, type AgentCLI, MemoryVFS } from 'one-tool';

import { buildDemoRuntime } from '../demo-runtime.js';
import {
  createExampleIO,
  getExampleArgs,
  printHeading,
  runIfEntrypoint,
  type ExampleRunOptions,
} from '../shared/example-utils.js';

export interface ToolEndpointServer {
  server: Server;
  close(): Promise<void>;
  url(): string;
}

export interface StartToolEndpointOptions {
  runtime?: AgentCLI;
  port?: number;
}

export async function startToolEndpoint(options: StartToolEndpointOptions = {}): Promise<ToolEndpointServer> {
  const runtime = options.runtime ?? (await buildDemoRuntime());
  const requestedPort = options.port ?? 8787;

  const server = createServer(async function (req, res): Promise<void> {
    if (req.method === 'GET' && req.url === '/tool-definition') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(buildToolDefinition(runtime), null, 2));
      return;
    }

    if (req.method === 'POST' && req.url === '/run') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }

      const bodyText = Buffer.concat(chunks).toString('utf8');
      let payload: { command?: string };
      try {
        payload = JSON.parse(bodyText) as { command?: string };
      } catch {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON body' }));
        return;
      }

      if (!payload.command) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'command is required' }));
        return;
      }

      const execution = await runtime.runDetailed(payload.command);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify(
          {
            command: payload.command,
            exitCode: execution.exitCode,
            output: execution.presentation.text,
          },
          null,
          2,
        ),
      );
      return;
    }

    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  await new Promise<void>(function (resolve, reject): void {
    server.once('error', reject);
    server.listen(requestedPort, function (): void {
      server.off('error', reject);
      resolve();
    });
  });

  return {
    server,
    close(): Promise<void> {
      return new Promise<void>(function (resolve, reject): void {
        server.close(function (error): void {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
    url(): string {
      const address = server.address();
      if (!address || typeof address === 'string') {
        throw new Error('server address unavailable');
      }
      return `http://127.0.0.1:${address.port}`;
    },
  };
}

export async function main(options: ExampleRunOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const args = getExampleArgs(options);
  const selfTest = args.includes('--self-test');
  const portArg = args.find(function (arg) {
    return arg !== '--self-test';
  });
  const port = portArg ? Number.parseInt(portArg, 10) : 8787;
  const runtime = selfTest
    ? await buildDemoRuntime({
        vfs: new MemoryVFS(),
      })
    : undefined;
  const toolEndpoint = await startToolEndpoint({
    port: selfTest ? 0 : Number.isFinite(port) ? port : 8787,
    ...(runtime === undefined ? {} : { runtime }),
  });

  printHeading(
    io,
    'Reference: HTTP tool endpoint',
    'This sample exposes GET /tool-definition and POST /run so a separate agent process can treat one-tool like a remote tool service.',
  );
  io.write(`Server listening on ${toolEndpoint.url()}`);
  io.write(`GET  ${toolEndpoint.url()}/tool-definition`);
  io.write(`POST ${toolEndpoint.url()}/run  {"command":"help"}`);

  if (selfTest) {
    try {
      const toolDefinitionResponse = await fetch(`${toolEndpoint.url()}/tool-definition`);
      const toolDefinition = (await toolDefinitionResponse.json()) as { function?: { name?: string } };
      const runResponse = await fetch(`${toolEndpoint.url()}/run`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({ command: 'help' }),
      });
      const runBody = (await runResponse.json()) as { output?: string };
      io.write(`Tool definition name: ${toolDefinition.function?.name ?? '(missing)'}`);
      io.write(`Run response preview: ${(runBody.output ?? '').split('\n')[0] ?? '(empty)'}`);
    } finally {
      await toolEndpoint.close();
    }
    return;
  }

  const stop = function (): void {
    void toolEndpoint.close().finally(function (): void {
      process.exit(0);
    });
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

await runIfEntrypoint(import.meta.url, main);
