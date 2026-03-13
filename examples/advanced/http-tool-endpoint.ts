import http from 'node:http';
import process from 'node:process';

import { MemoryVFS, buildToolDefinition, createAgentCLI } from '@onetool/one-tool';

import {
  createExampleIO,
  getExampleArgs,
  runIfEntrypointWithErrorHandling,
  type ExampleOptions,
} from '../_example-utils.js';

interface ToolEndpoint {
  server: http.Server;
  close(): Promise<void>;
  url(): string;
}

async function buildRuntime() {
  const encoder = new TextEncoder();
  const vfs = new MemoryVFS();
  await vfs.writeBytes('/notes/todo.txt', encoder.encode('review logs\nwrite summary\n'));
  return createAgentCLI({ vfs });
}

async function startToolEndpoint(requestedPort: number): Promise<ToolEndpoint> {
  const runtime = await buildRuntime();
  const server = http.createServer(async function (req, res): Promise<void> {
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

      let payload: { command?: string };
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { command?: string };
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

export async function main(options: ExampleOptions = {}): Promise<void> {
  const io = createExampleIO(options);
  const args = getExampleArgs(options);
  const selfTest = args.includes('--self-test');
  const portArg = args.find(function (arg) {
    return arg !== '--self-test';
  });
  const requestedPort = portArg ? Number.parseInt(portArg, 10) : 8787;
  const endpoint = await startToolEndpoint(
    selfTest ? 0 : Number.isFinite(requestedPort) ? requestedPort : 8787,
  );

  io.write('Advanced · HTTP tool endpoint');
  io.write('Expose one-tool over a small HTTP service for remote agents or orchestrators.');
  io.write(`GET  ${endpoint.url()}/tool-definition`);
  io.write(`POST ${endpoint.url()}/run  {"command":"help"}`);

  if (selfTest) {
    try {
      const toolDefinitionResponse = await fetch(`${endpoint.url()}/tool-definition`);
      const toolDefinition = (await toolDefinitionResponse.json()) as { function?: { name?: string } };
      const runResponse = await fetch(`${endpoint.url()}/run`, {
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
      await endpoint.close();
    }
    return;
  }

  const stop = function (): void {
    void endpoint.close().finally(function (): void {
      process.exit(0);
    });
  };

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

await runIfEntrypointWithErrorHandling(import.meta.url, main);
