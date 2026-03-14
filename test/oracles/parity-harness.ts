import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { textEncoder } from '../../src/types.js';

export interface OracleCommandResult {
  stdout: Uint8Array;
  stderr: string;
  exitCode: number;
}

export interface OracleProcessOptions {
  cwd?: string;
  stdin?: Uint8Array;
  env?: NodeJS.ProcessEnv;
}

export interface OracleDirectoryFixture {
  kind: 'dir';
}

export type OracleWorkspaceEntry = string | Uint8Array | OracleDirectoryFixture;

export type OracleWorkspaceFiles = Record<string, OracleWorkspaceEntry>;

export interface OracleWorkspace {
  rootDir: string;
  path(relativePath: string): string;
  run(
    command: string,
    args: string[],
    options?: Omit<OracleProcessOptions, 'cwd'>,
  ): Promise<OracleCommandResult>;
}

export function oracleDirectory(): OracleDirectoryFixture {
  return { kind: 'dir' };
}

export function createOracleEnv(extraEnv: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...extraEnv,
    LC_ALL: 'C',
    LANG: 'C',
  };
}

export async function hasOracleUtility(command: string): Promise<boolean> {
  return new Promise<boolean>(function (resolve) {
    const child = spawn('sh', ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', command], {
      stdio: ['ignore', 'ignore', 'ignore'],
      env: createOracleEnv(),
    });

    child.once('error', function () {
      resolve(false);
    });
    child.once('close', function (code) {
      resolve(code === 0);
    });
  });
}

export async function listMissingOracleUtilities(commands: readonly string[]): Promise<string[]> {
  const missing: string[] = [];

  for (const command of commands) {
    if (!(await hasOracleUtility(command))) {
      missing.push(command);
    }
  }

  return missing;
}

export async function withOracleFixtureWorkspace<T>(
  files: OracleWorkspaceFiles,
  run: (workspace: OracleWorkspace) => Promise<T>,
): Promise<T> {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'one-tool-oracle-'));
  const workspace = createOracleWorkspace(rootDir);

  try {
    await seedOracleWorkspace(rootDir, files);
    return await run(workspace);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

export function createOracleWorkspace(rootDir: string): OracleWorkspace {
  return {
    rootDir,
    path(relativePath: string): string {
      return fixturePath(rootDir, relativePath);
    },
    run(
      command: string,
      args: string[],
      options: Omit<OracleProcessOptions, 'cwd'> = {},
    ): Promise<OracleCommandResult> {
      return runOracleProcess(command, args, {
        ...options,
        cwd: rootDir,
      });
    },
  };
}

export async function seedOracleWorkspace(rootDir: string, files: OracleWorkspaceFiles): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = fixturePath(rootDir, relativePath);

    if (isOracleDirectoryFixture(content)) {
      await mkdir(targetPath, { recursive: true });
      continue;
    }

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, typeof content === 'string' ? textEncoder.encode(content) : content);
  }
}

export async function runOracleProcess(
  command: string,
  args: string[],
  options: OracleProcessOptions = {},
): Promise<OracleCommandResult> {
  return new Promise<OracleCommandResult>(function (resolve, reject) {
    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: createOracleEnv(options.env),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.once('error', reject);
    child.stdout.on('data', function (chunk: Uint8Array) {
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', function (chunk: Uint8Array) {
      stderrChunks.push(chunk);
    });
    child.stdin.on('error', function (caught: NodeJS.ErrnoException) {
      if (caught.code !== 'EPIPE') {
        reject(caught);
      }
    });
    child.once('close', function (code) {
      resolve({
        stdout: concatBytes(stdoutChunks),
        stderr: Buffer.from(concatBytes(stderrChunks)).toString('utf8'),
        exitCode: code ?? 1,
      });
    });

    child.stdin.end(options.stdin ?? new Uint8Array());
  });
}

export function fixturePath(rootDir: string, relativePath: string): string {
  const targetPath = path.resolve(rootDir, relativePath.replace(/^\/+/, ''));
  const relativeToRoot = path.relative(rootDir, targetPath);

  if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
    throw new Error(`oracle fixture escapes root: ${relativePath}`);
  }

  return targetPath;
}

export async function runSedOracle(
  args: string[],
  options: OracleProcessOptions = {},
): Promise<OracleCommandResult> {
  return runOracleProcess('sed', args, options);
}

export async function runTrOracle(
  args: string[],
  options: OracleProcessOptions = {},
): Promise<OracleCommandResult> {
  return runOracleProcess('tr', args, options);
}

export async function runEchoOracle(
  args: string[],
  options: OracleProcessOptions = {},
): Promise<OracleCommandResult> {
  return runOracleProcess('echo', args, options);
}

export async function runGrepOracle(
  args: string[],
  options: OracleProcessOptions = {},
): Promise<OracleCommandResult> {
  return runOracleProcess('grep', args, options);
}

export async function runLsOracle(
  args: string[],
  options: OracleProcessOptions = {},
): Promise<OracleCommandResult> {
  return runOracleProcess('ls', args, options);
}

export async function runFindOracle(
  args: string[],
  options: OracleProcessOptions = {},
): Promise<OracleCommandResult> {
  return runOracleProcess('find', args, options);
}

export async function runDiffOracle(
  args: string[],
  options: OracleProcessOptions = {},
): Promise<OracleCommandResult> {
  return runOracleProcess('diff', args, options);
}

function isOracleDirectoryFixture(value: OracleWorkspaceEntry): value is OracleDirectoryFixture {
  return typeof value === 'object' && value !== null && 'kind' in value && value.kind === 'dir';
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce(function (sum, chunk) {
    return sum + chunk.length;
  }, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}
