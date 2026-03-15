import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { createCommandRegistry, type BuiltinCommandSelection, type CommandSpec } from '../src/commands/index.js';
import { resolveExecutionPolicy, type AgentCLIExecutionPolicy } from '../src/execution-policy.js';
import { SimpleMemory } from '../src/memory.js';
import { parseCommandLine, ParseError, tokenizeCommandLine } from '../src/parser.js';
import { AgentCLI, type AgentCLIOutputLimits, type PipelineExecutionTrace, type RunExecution } from '../src/runtime.js';
import { DemoFetch, DemoSearch } from '../src/testing/adapters.js';
import {
  assertScenario,
  buildWorld,
  createTestCommandContext,
  runOracle,
  runRegisteredCommand,
  type DemoSearchDocument,
  type ScenarioSpec,
} from '../src/testing/index.js';
import { err, ok, okBytes, type CommandResult } from '../src/types.js';
import { errorMessage, formatDuration, formatSize, looksBinary, safeEvalArithmetic } from '../src/utils.js';
import { toVfsError, type VfsErrorCode } from '../src/vfs/errors.js';
import type { VFS } from '../src/vfs/interface.js';
import { MemoryVFS } from '../src/vfs/memory-vfs.js';
import { baseName, isStrictDescendantPath, parentOf, posixNormalize } from '../src/vfs/path-utils.js';
import type { VfsResourcePolicy } from '../src/vfs/policy.js';
import {
  COMMAND_EXTRA_CASES,
  DEFAULT_ADAPTER_WORLD,
  RUNTIME_DESCRIPTION_CASES,
  RUNTIME_EXECUTION_CASES,
  SCENARIO_CASES,
  type CommandSnapshotCase,
  type RuntimeCustomCommandId,
  type RuntimeDescriptionCase,
  type RuntimeSnapshotCase,
  type SnapshotDirectoryEntry,
  type SnapshotFileEntry,
  type SnapshotWorld,
} from './snapshot-cases.js';

interface TokenizerCase {
  input: string;
}

interface ParserErrorCase {
  input: string;
  stage: 'tokenize' | 'parse';
}

interface ArithmeticCase {
  expression: string;
}

interface FormatCase {
  kind: 'duration' | 'size';
  input: number;
}

interface BinaryCase {
  data: Uint8Array;
}

interface PathUtilsCase {
  kind: 'normalize' | 'parentOf' | 'baseName' | 'isStrictDescendantPath';
  input?: string;
  ancestor?: string;
  candidate?: string;
}

interface MemoryVfsStep {
  op:
    | 'writeBytes'
    | 'appendBytes'
    | 'mkdir'
    | 'listdir'
    | 'readBytes'
    | 'readText'
    | 'delete'
    | 'copy'
    | 'move'
    | 'exists'
    | 'isDir'
    | 'stat';
  path?: string;
  src?: string;
  dst?: string;
  data?: Uint8Array;
  parents?: boolean;
}

interface MemoryVfsCase {
  id: string;
  resourcePolicy?: {
    maxFileBytes?: number;
    maxTotalBytes?: number;
    maxDirectoryDepth?: number;
    maxEntriesPerDirectory?: number;
    maxOutputArtifactBytes?: number;
  };
  steps: MemoryVfsStep[];
}

interface MemoryVfsStepSnapshot {
  op: MemoryVfsStep['op'];
  path?: string;
  src?: string;
  dst?: string;
  parents?: boolean;
  data_b64?: string;
  result?:
    | string
    | boolean
    | string[]
    | { src: string; dst: string }
    | {
        path: string;
        exists: boolean;
        isDir: boolean;
        size: number;
        mediaType: string;
        modifiedEpochMs: number;
      };
  error?: {
    code: VfsErrorCode;
    path: string;
    targetPath?: string;
    details?: Record<string, unknown>;
    message: string;
  };
}

interface SerializedTextFileEntry {
  kind: 'text';
  text: string;
}

interface SerializedBinaryFileEntry {
  kind: 'bytes';
  data_b64: string;
}

type SerializedRawFileEntry = SnapshotDirectoryEntry | SerializedTextFileEntry | SerializedBinaryFileEntry;

interface SerializedWorldStateFileEntry {
  path: string;
  kind: 'dir' | 'text' | 'bytes';
  text?: string;
  data_b64?: string;
}

interface SerializedMemoryItem {
  id: number;
  text: string;
  createdEpochMs: number;
  metadata: Record<string, unknown>;
}

interface SerializedCommandResult {
  stdout_b64: string;
  stdout_text?: string;
  stderr: string;
  exitCode: number;
  contentType: string;
}

const SNAPSHOT_ROOT = path.resolve('snapshots');
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');
const EMPTY_STDIN = new Uint8Array();

const TOKENIZER_CASES: TokenizerCase[] = [
  { input: 'ls /foo' },
  { input: 'a | b && c || d ; e' },
  { input: "write /f 'hello world'" },
  { input: 'write /f "hello world"' },
  { input: 'write /f "say \\"hi\\""' },
  { input: "echo '--- types ---' && sed -n '1,2p' /docs/types.txt" },
  { input: 'cat /f | grep x' },
  { input: 'write ../../outside.txt safe && stat /outside.txt' },
  { input: 'grep "^Owner:" /accounts/acme.md | memory store' },
];

const PARSER_CASES: TokenizerCase[] = [
  { input: 'ls' },
  { input: 'cat /f | grep x' },
  { input: 'a && b || c ; d' },
  { input: 'a | b && c || d ; e' },
  {
    input:
      "echo '--- types ---' && sed -n '1,2p' /docs/types.txt && echo \"--- tests ---\" && grep -E 'cat:|mkdir:|rm:' /docs/tests.txt",
  },
  { input: 'cat /config/prod-missing.json || cat /config/default.json | json get region' },
  { input: 'write ../../outside.txt safe && stat /outside.txt' },
  { input: 'search refund timeout | write /reports/refund.txt' },
];

const PARSER_ERROR_CASES: ParserErrorCase[] = [
  { input: '', stage: 'tokenize' },
  { input: 'write /f "unterminated', stage: 'tokenize' },
  { input: 'write /f trailing\\', stage: 'tokenize' },
  { input: 'echo $(whoami)', stage: 'tokenize' },
  { input: 'echo `whoami`', stage: 'tokenize' },
  { input: 'cat /f > out.txt', stage: 'tokenize' },
  { input: 'cat /f < in.txt', stage: 'tokenize' },
  { input: 'long_task &', stage: 'tokenize' },
  { input: 'a |', stage: 'parse' },
  { input: 'a &&', stage: 'parse' },
  { input: 'a | | b', stage: 'parse' },
  { input: '   ', stage: 'parse' },
];

const ARITHMETIC_CASES: ArithmeticCase[] = [
  { expression: '1 + 2 * 3' },
  { expression: '(1 + 2) * 3' },
  { expression: '2 ** 3 ** 2' },
  { expression: '7 // 2' },
  { expression: '7 % 4' },
  { expression: '-3 + 5' },
  { expression: '2 ** 0.5' },
  { expression: '.5 + .25' },
  { expression: '10 / 4' },
  { expression: '1 / 0' },
  { expression: '' },
  { expression: '2 + abc' },
];

const FORMAT_CASES: FormatCase[] = [
  { kind: 'duration', input: 0 },
  { kind: 'duration', input: 999 },
  { kind: 'duration', input: 1000 },
  { kind: 'duration', input: 1550 },
  { kind: 'duration', input: 61_000 },
  { kind: 'size', input: 0 },
  { kind: 'size', input: 1023 },
  { kind: 'size', input: 1024 },
  { kind: 'size', input: 1536 },
  { kind: 'size', input: 1024 ** 2 },
  { kind: 'size', input: 1024 ** 3 },
];

const BINARY_CASES: BinaryCase[] = [
  { data: new Uint8Array() },
  { data: Uint8Array.from([65, 0, 66]) },
  { data: textEncoder.encode('hello\nworld') },
  { data: Uint8Array.from([0xff, 0xfe, 0xfd]) },
  { data: Uint8Array.from([1, 2, 3, 65, 66, 67, 68, 69, 70]) },
];

const PATH_UTILS_CASES: PathUtilsCase[] = [
  { kind: 'normalize', input: '/' },
  { kind: 'normalize', input: '/foo/bar' },
  { kind: 'normalize', input: 'foo/bar' },
  { kind: 'normalize', input: '/foo/../bar' },
  { kind: 'normalize', input: '/foo/./bar' },
  { kind: 'normalize', input: '//foo//bar//' },
  { kind: 'normalize', input: '/../../etc/passwd' },
  { kind: 'normalize', input: '/../..' },
  { kind: 'parentOf', input: '/' },
  { kind: 'parentOf', input: '/foo' },
  { kind: 'parentOf', input: '/foo/bar' },
  { kind: 'baseName', input: '/' },
  { kind: 'baseName', input: '/foo' },
  { kind: 'baseName', input: '/foo/bar.txt' },
  { kind: 'isStrictDescendantPath', ancestor: '/', candidate: '/foo' },
  { kind: 'isStrictDescendantPath', ancestor: '/foo', candidate: '/foo' },
  { kind: 'isStrictDescendantPath', ancestor: '/foo', candidate: '/foo/bar' },
  { kind: 'isStrictDescendantPath', ancestor: '/foo', candidate: '/foobar' },
];

const MEMORY_VFS_CASES: MemoryVfsCase[] = [
  {
    id: 'write-read-roundtrip',
    steps: [
      { op: 'writeBytes', path: '/test.txt', data: encodeText('hello world') },
      { op: 'readBytes', path: '/test.txt' },
      { op: 'readText', path: '/test.txt' },
      { op: 'stat', path: '/test.txt' },
    ],
  },
  {
    id: 'append-existing-and-missing',
    steps: [
      { op: 'writeBytes', path: '/test.txt', data: encodeText('hello') },
      { op: 'appendBytes', path: '/test.txt', data: encodeText(' world') },
      { op: 'appendBytes', path: '/new.txt', data: encodeText('content') },
      { op: 'readText', path: '/test.txt' },
      { op: 'readText', path: '/new.txt' },
    ],
  },
  {
    id: 'mkdir-listdir-stat-dir',
    steps: [
      { op: 'mkdir', path: '/a/b/c', parents: true },
      { op: 'writeBytes', path: '/z.txt', data: encodeText('') },
      { op: 'writeBytes', path: '/a.txt', data: encodeText('') },
      { op: 'mkdir', path: '/m-dir', parents: true },
      { op: 'listdir', path: '/' },
      { op: 'stat', path: '/a/b/c' },
      { op: 'exists', path: '/a' },
      { op: 'isDir', path: '/a/b' },
    ],
  },
  {
    id: 'copy-and-move-trees',
    steps: [
      { op: 'writeBytes', path: '/src/main.ts', data: encodeText('code') },
      { op: 'writeBytes', path: '/src/lib/util.ts', data: encodeText('util') },
      { op: 'copy', src: '/src', dst: '/dst' },
      { op: 'move', src: '/dst', dst: '/archive' },
      { op: 'readText', path: '/archive/main.ts' },
      { op: 'readText', path: '/archive/lib/util.ts' },
      { op: 'exists', path: '/dst' },
    ],
  },
  {
    id: 'delete-recursive',
    steps: [
      { op: 'writeBytes', path: '/dir/sub/file.txt', data: encodeText('x') },
      { op: 'delete', path: '/dir' },
      { op: 'exists', path: '/dir' },
      { op: 'exists', path: '/dir/sub/file.txt' },
    ],
  },
  {
    id: 'errors-and-collisions',
    steps: [
      { op: 'listdir', path: '/missing' },
      { op: 'writeBytes', path: '/file.txt', data: encodeText('x') },
      { op: 'listdir', path: '/file.txt' },
      { op: 'readBytes', path: '/missing' },
      { op: 'mkdir', path: '/dir', parents: true },
      { op: 'readBytes', path: '/dir' },
      { op: 'delete', path: '/' },
      { op: 'copy', src: '/dir', dst: '/dir/sub' },
      { op: 'move', src: '/dir', dst: '/dir/sub' },
    ],
  },
  {
    id: 'resource-limits',
    resourcePolicy: {
      maxFileBytes: 3,
      maxTotalBytes: 5,
      maxDirectoryDepth: 2,
      maxEntriesPerDirectory: 1,
      maxOutputArtifactBytes: 2,
    },
    steps: [
      { op: 'writeBytes', path: '/notes/report.txt', data: encodeText('hello') },
      { op: 'writeBytes', path: '/a.txt', data: encodeText('abc') },
      { op: 'writeBytes', path: '/b.txt', data: encodeText('def') },
      { op: 'writeBytes', path: '/a/b/c/file.txt', data: encodeText('x') },
      { op: 'writeBytes', path: '/first.txt', data: encodeText('a') },
      { op: 'writeBytes', path: '/second.txt', data: encodeText('b') },
      { op: 'writeBytes', path: '/.system/cmd-output/cmd-0001.txt', data: encodeText('abc') },
    ],
  },
];

async function main(): Promise<void> {
  await rm(SNAPSHOT_ROOT, { recursive: true, force: true });
  await mkdir(SNAPSHOT_ROOT, { recursive: true });

  const parserCount = await writeParserSnapshots();
  const vfsCount = await writeVfsSnapshots();
  const utilsCount = await writeUtilsSnapshots();
  const commandCount = await writeCommandSnapshots();
  const runtimeCount = await writeRuntimeSnapshots();
  const scenarioCount = await writeScenarioSnapshots();

  await writeJson(path.join(SNAPSHOT_ROOT, 'manifest.json'), {
    version: 2,
    domains: {
      parser: parserCount,
      vfs: vfsCount,
      utils: utilsCount,
      commands: commandCount,
      runtime: runtimeCount,
      scenarios: scenarioCount,
    },
  });
}

async function writeParserSnapshots(): Promise<number> {
  await writeJsonl(
    path.join(SNAPSHOT_ROOT, 'parser', 'tokenizer.jsonl'),
    TOKENIZER_CASES.map(function (testCase) {
      return {
        input: testCase.input,
        tokens: tokenizeCommandLine(testCase.input),
      };
    }),
  );

  await writeJsonl(
    path.join(SNAPSHOT_ROOT, 'parser', 'ast.jsonl'),
    PARSER_CASES.map(function (testCase) {
      return {
        input: testCase.input,
        ast: parseCommandLine(testCase.input),
      };
    }),
  );

  await writeJsonl(
    path.join(SNAPSHOT_ROOT, 'parser', 'errors.jsonl'),
    PARSER_ERROR_CASES.map(function (testCase) {
      return {
        input: testCase.input,
        stage: testCase.stage,
        error: captureParserError(testCase),
      };
    }),
  );

  return TOKENIZER_CASES.length + PARSER_CASES.length + PARSER_ERROR_CASES.length;
}

async function writeVfsSnapshots(): Promise<number> {
  await writeJsonl(
    path.join(SNAPSHOT_ROOT, 'vfs', 'path-utils.jsonl'),
    PATH_UTILS_CASES.map(function (testCase) {
      return snapshotPathUtilsCase(testCase);
    }),
  );

  const memoryRows: unknown[] = [];
  for (const testCase of MEMORY_VFS_CASES) {
    memoryRows.push(await withMockedNow(async function (): Promise<unknown> {
      return snapshotMemoryVfsCase(testCase);
    }));
  }

  await writeJsonl(path.join(SNAPSHOT_ROOT, 'vfs', 'memory-vfs.jsonl'), memoryRows);
  return PATH_UTILS_CASES.length + MEMORY_VFS_CASES.length;
}

async function writeUtilsSnapshots(): Promise<number> {
  await writeJsonl(
    path.join(SNAPSHOT_ROOT, 'utils', 'arithmetic.jsonl'),
    ARITHMETIC_CASES.map(function (testCase) {
      return snapshotArithmeticCase(testCase);
    }),
  );

  await writeJsonl(
    path.join(SNAPSHOT_ROOT, 'utils', 'format.jsonl'),
    FORMAT_CASES.map(function (testCase) {
      return {
        kind: testCase.kind,
        input: testCase.input,
        output: testCase.kind === 'duration' ? formatDuration(testCase.input) : formatSize(testCase.input),
      };
    }),
  );

  await writeJsonl(
    path.join(SNAPSHOT_ROOT, 'utils', 'binary-detection.jsonl'),
    BINARY_CASES.map(function (testCase) {
      return {
        data_b64: toBase64(testCase.data),
        looksBinary: looksBinary(testCase.data),
      };
    }),
  );

  return ARITHMETIC_CASES.length + FORMAT_CASES.length + BINARY_CASES.length;
}

async function writeCommandSnapshots(): Promise<number> {
  const cases = [...buildConformanceCommandCases(), ...COMMAND_EXTRA_CASES];
  validateUniqueCaseIds(cases);

  for (const testCase of cases) {
    const payload = await snapshotCommandCase(testCase);
    const snapshotGroup = testCase.snapshotGroup ?? testCase.commandName;
    await writeJson(path.join(SNAPSHOT_ROOT, 'commands', snapshotGroup, `${testCase.id}.json`), payload);
  }

  return cases.length;
}

async function writeRuntimeSnapshots(): Promise<number> {
  for (const testCase of RUNTIME_EXECUTION_CASES) {
    const payload = await snapshotRuntimeCase(testCase);
    await writeJson(path.join(SNAPSHOT_ROOT, 'runtime', 'executions', `${testCase.id}.json`), payload);
  }

  for (const testCase of RUNTIME_DESCRIPTION_CASES) {
    const payload = await snapshotRuntimeDescriptionCase(testCase);
    await writeJson(path.join(SNAPSHOT_ROOT, 'runtime', 'descriptions', `${testCase.id}.json`), payload);
  }

  return RUNTIME_EXECUTION_CASES.length + RUNTIME_DESCRIPTION_CASES.length;
}

async function writeScenarioSnapshots(): Promise<number> {
  for (const scenario of SCENARIO_CASES) {
    const payload = await snapshotScenarioCase(scenario);
    await writeJson(path.join(SNAPSHOT_ROOT, 'scenarios', `${scenario.id}.json`), payload);
  }

  return SCENARIO_CASES.length;
}

function buildConformanceCommandCases(): CommandSnapshotCase[] {
  const registry = createCommandRegistry();
  const cases: CommandSnapshotCase[] = [];

  for (const spec of registry.all()) {
    const representativeWorld = representativeWorldFor(spec);

    cases.push({
      id: 'conformance-representative',
      commandName: spec.name,
      args: [...(spec.conformanceArgs ?? [])],
      ...(representativeWorld === undefined ? {} : { world: representativeWorld }),
    });

    if (registry.has('help')) {
      cases.push({
        id: 'conformance-help-entry',
        commandName: 'help',
        snapshotGroup: spec.name,
        args: [spec.name],
      });
    }

    if (spec.acceptsStdin === false) {
      cases.push({
        id: 'conformance-stdin-rejection',
        commandName: spec.name,
        args: [...(spec.conformanceArgs ?? [])],
        stdin: encodeText('unwanted stdin'),
        ...(representativeWorld === undefined ? {} : { world: representativeWorld }),
      });
    }

    if ((spec.minArgs ?? 0) > 0) {
      cases.push({
        id: 'conformance-too-few-args',
        commandName: spec.name,
        args: tooFewArgsFor(spec),
      });
    }

    if (spec.maxArgs !== undefined) {
      cases.push({
        id: 'conformance-too-many-args',
        commandName: spec.name,
        args: tooManyArgsFor(spec),
      });
    }

    if (spec.requiresAdapter !== undefined) {
      cases.push({
        id: `conformance-missing-${spec.requiresAdapter}-adapter`,
        commandName: spec.name,
        args: adapterArgsFor(spec),
      });
    }
  }

  return cases;
}

function representativeWorldFor(spec: CommandSpec): SnapshotWorld | undefined {
  if (spec.requiresAdapter === undefined) {
    return undefined;
  }
  return DEFAULT_ADAPTER_WORLD;
}

function adapterArgsFor(spec: CommandSpec): string[] {
  if ((spec.conformanceArgs ?? []).length > 0) {
    return [...spec.conformanceArgs!];
  }

  const count = Math.max(spec.minArgs ?? 0, 1);
  return Array.from({ length: count }, function (_, index) {
    return `arg${index}`;
  });
}

function tooFewArgsFor(spec: CommandSpec): string[] {
  const count = Math.max((spec.minArgs ?? 0) - 1, 0);
  return Array.from({ length: count }, function (_, index) {
    return `arg${index}`;
  });
}

function tooManyArgsFor(spec: CommandSpec): string[] {
  const count = (spec.maxArgs ?? 0) + 1;
  return Array.from({ length: count }, function (_, index) {
    return `arg${index}`;
  });
}

function validateUniqueCaseIds(cases: CommandSnapshotCase[]): void {
  const seen = new Set<string>();

  for (const testCase of cases) {
    const snapshotGroup = testCase.snapshotGroup ?? testCase.commandName;
    const key = `${snapshotGroup}:${testCase.id}`;
    if (seen.has(key)) {
      throw new Error(`duplicate command snapshot case: ${key}`);
    }
    seen.add(key);
  }
}

async function snapshotCommandCase(testCase: CommandSnapshotCase): Promise<Record<string, unknown>> {
  return withMockedNow(async function (): Promise<Record<string, unknown>> {
    const ctx = createTestCommandContext({
      registry: createCommandRegistry(),
      vfs: new MemoryVFS(
        testCase.vfsResourcePolicy === undefined ? {} : { resourcePolicy: testCase.vfsResourcePolicy },
      ),
      adapters: buildAdapters(testCase.world),
      memory: new SimpleMemory(),
      executionPolicy: resolveExecutionPolicy(testCase.executionPolicy),
      outputDir: '/.system/cmd-output',
      outputCounter: 0,
    });

    await seedSnapshotWorld(ctx.vfs, ctx.memory, testCase.world);
    const stdin = testCase.stdin ?? EMPTY_STDIN;
    const { result } = await runRegisteredCommand(testCase.commandName, testCase.args, {
      ctx,
      stdin,
    });

    return {
      id: testCase.id,
      command: testCase.commandName,
      ...(testCase.snapshotGroup === undefined ? {} : { snapshotGroup: testCase.snapshotGroup }),
      args: [...testCase.args],
      stdin_b64: toBase64(stdin),
      ...(testCase.world === undefined ? {} : { world: serializeSnapshotWorld(testCase.world) }),
      ...(testCase.executionPolicy === undefined
        ? {}
        : { executionPolicy: serializeExecutionPolicy(testCase.executionPolicy) }),
      ...(testCase.vfsResourcePolicy === undefined
        ? {}
        : { vfsResourcePolicy: serializeVfsResourcePolicy(testCase.vfsResourcePolicy) }),
      result: serializeCommandResult(result),
      worldAfter: await snapshotWorldState(ctx.vfs, ctx.memory),
    };
  });
}

async function snapshotRuntimeCase(testCase: RuntimeSnapshotCase): Promise<Record<string, unknown>> {
  return withMockedNow(async function (): Promise<Record<string, unknown>> {
    const runtime = await createSnapshotRuntime(testCase);
    const execution = await runtime.runDetailed(testCase.commandLine);

    return {
      id: testCase.id,
      commandLine: testCase.commandLine,
      ...(testCase.world === undefined ? {} : { world: serializeSnapshotWorld(testCase.world) }),
      ...(testCase.builtinCommands === undefined ? {} : { builtinCommands: testCase.builtinCommands }),
      ...(testCase.customCommands === undefined ? {} : { customCommands: testCase.customCommands }),
      ...(testCase.outputLimits === undefined ? {} : { outputLimits: testCase.outputLimits }),
      ...(testCase.executionPolicy === undefined
        ? {}
        : { executionPolicy: serializeExecutionPolicy(testCase.executionPolicy) }),
      ...(testCase.vfsResourcePolicy === undefined
        ? {}
        : { vfsResourcePolicy: serializeVfsResourcePolicy(testCase.vfsResourcePolicy) }),
      execution: serializeRunExecution(execution),
      worldAfter: await snapshotWorldState(runtime.ctx.vfs, runtime.ctx.memory),
    };
  });
}

async function snapshotRuntimeDescriptionCase(testCase: RuntimeDescriptionCase): Promise<Record<string, unknown>> {
  const runtime = await createSnapshotRuntime({
    ...(testCase.builtinCommands === undefined ? {} : { builtinCommands: testCase.builtinCommands }),
    ...(testCase.customCommands === undefined ? {} : { customCommands: testCase.customCommands }),
  });

  return {
    id: testCase.id,
    variant: testCase.variant,
    ...(testCase.builtinCommands === undefined ? {} : { builtinCommands: testCase.builtinCommands }),
    ...(testCase.customCommands === undefined ? {} : { customCommands: testCase.customCommands }),
    description: runtime.buildToolDescription(testCase.variant),
  };
}

async function snapshotScenarioCase(scenario: ScenarioSpec): Promise<Record<string, unknown>> {
  return withMockedNow(async function (): Promise<Record<string, unknown>> {
    const runtime = await buildWorld(scenario.world);
    const trace = await runOracle(runtime, scenario);
    const assertionResult = await assertScenario(scenario, trace, runtime);

    return {
      id: scenario.id,
      scenario: serializeScenarioSpec(scenario),
      trace: serializeOracleTrace(trace),
      assertionResult,
      worldAfter: await snapshotWorldState(runtime.ctx.vfs, runtime.ctx.memory),
    };
  });
}

async function createSnapshotRuntime(testCase: {
  world?: SnapshotWorld;
  builtinCommands?: BuiltinCommandSelection | false;
  customCommands?: RuntimeCustomCommandId[];
  outputLimits?: AgentCLIOutputLimits;
  executionPolicy?: AgentCLIExecutionPolicy;
  vfsResourcePolicy?: VfsResourcePolicy;
}): Promise<AgentCLI> {
  const vfs = new MemoryVFS(
    testCase.vfsResourcePolicy === undefined ? {} : { resourcePolicy: testCase.vfsResourcePolicy },
  );
  const memory = new SimpleMemory();

  await seedSnapshotWorld(vfs, memory, testCase.world);

  const runtime = new AgentCLI({
    vfs,
    adapters: buildAdapters(testCase.world),
    memory,
    ...(testCase.builtinCommands === undefined ? {} : { builtinCommands: testCase.builtinCommands }),
    ...(testCase.customCommands === undefined ? {} : { commands: runtimeFixtureCommands(testCase.customCommands) }),
    ...(testCase.outputLimits === undefined ? {} : { outputLimits: testCase.outputLimits }),
    ...(testCase.executionPolicy === undefined ? {} : { executionPolicy: testCase.executionPolicy }),
  });

  await runtime.initialize();
  return runtime;
}

function runtimeFixtureCommands(ids: RuntimeCustomCommandId[]): CommandSpec[] {
  return ids.map(function (id) {
    switch (id) {
      case 'echo':
        return {
          name: 'echo',
          summary: 'Echo text.',
          usage: 'echo <text...>',
          details: 'Examples:\n  echo hello',
          async handler(_ctx, args): Promise<CommandResult> {
            return ok(args.join(' '));
          },
        };
      case 'fail':
        return {
          name: 'fail',
          summary: 'Fail immediately.',
          usage: 'fail',
          details: 'Examples:\n  fail',
          async handler(): Promise<CommandResult> {
            return err('fail: forced failure');
          },
        };
      case 'burst':
        return {
          name: 'burst',
          summary: 'Emit three lines.',
          usage: 'burst',
          details: 'Examples:\n  burst',
          async handler(): Promise<CommandResult> {
            return ok('first line\nsecond line\nthird line');
          },
        };
      case 'binary':
        return {
          name: 'binary',
          summary: 'Emit binary bytes.',
          usage: 'binary',
          details: 'Examples:\n  binary',
          async handler(): Promise<CommandResult> {
            return okBytes(Uint8Array.of(0, 1, 2, 3), 'application/octet-stream');
          },
        };
      case 'longline':
        return {
          name: 'longline',
          summary: 'Emit one long line.',
          usage: 'longline',
          details: 'Examples:\n  longline',
          async handler(): Promise<CommandResult> {
            return ok('abcdefghijklmnopqrstuvwxyz');
          },
        };
      case 'help-override':
        return {
          name: 'help',
          summary: 'Overridden help.',
          usage: 'help',
          details: 'Examples:\n  help',
          async handler(): Promise<CommandResult> {
            return ok('override help');
          },
        };
      default: {
        const _never: never = id;
        return _never;
      }
    }
  });
}

async function seedSnapshotWorld(vfs: VFS, memory: SimpleMemory, world: SnapshotWorld | undefined): Promise<void> {
  if (world?.files !== undefined) {
    const entries = Object.entries(world.files).sort(function ([left], [right]) {
      return left.localeCompare(right);
    });

    for (const [filePath, entry] of entries) {
      if (isSnapshotDirectoryEntry(entry)) {
        await vfs.mkdir(filePath, true);
        continue;
      }

      const bytes = typeof entry === 'string' ? encodeText(entry) : entry;
      await vfs.writeBytes(filePath, bytes, true);
    }
  }

  if (world?.memory !== undefined) {
    for (const item of world.memory) {
      memory.store(item);
    }
  }
}

function buildAdapters(world: SnapshotWorld | undefined): {
  search?: DemoSearch;
  fetch?: DemoFetch;
} {
  const adapters: {
    search?: DemoSearch;
    fetch?: DemoFetch;
  } = {};

  if (world?.searchDocs !== undefined) {
    adapters.search = new DemoSearch(world.searchDocs);
  }

  if (world?.fetchResources !== undefined) {
    adapters.fetch = new DemoFetch(world.fetchResources);
  }

  return adapters;
}

function serializeSnapshotWorld(world: SnapshotWorld): Record<string, unknown> {
  return {
    ...(world.files === undefined ? {} : { files: serializeRawFileEntries(world.files) }),
    ...(world.searchDocs === undefined ? {} : { searchDocs: world.searchDocs }),
    ...(world.fetchResources === undefined ? {} : { fetchResources: serializeFetchResources(world.fetchResources) }),
    ...(world.memory === undefined ? {} : { memory: [...world.memory] }),
    ...(world.outputLimits === undefined ? {} : { outputLimits: world.outputLimits }),
  };
}

function serializeRawFileEntries(entries: Record<string, SnapshotFileEntry>): Record<string, SerializedRawFileEntry> {
  const serialized: Record<string, SerializedRawFileEntry> = {};

  for (const filePath of Object.keys(entries).sort(function (left, right) {
    return left.localeCompare(right);
  })) {
    const entry = entries[filePath]!;
    if (isSnapshotDirectoryEntry(entry)) {
      serialized[filePath] = { kind: 'dir' };
      continue;
    }

    if (typeof entry === 'string') {
      serialized[filePath] = {
        kind: 'text',
        text: entry,
      };
      continue;
    }

    serialized[filePath] = {
      kind: 'bytes',
      data_b64: toBase64(entry),
    };
  }

  return serialized;
}

function serializeFetchResources(resources: Record<string, unknown>): Record<string, unknown> {
  const serialized: Record<string, unknown> = {};

  for (const resource of Object.keys(resources).sort(function (left, right) {
    return left.localeCompare(right);
  })) {
    serialized[resource] = serializeFetchPayload(resources[resource]);
  }

  return serialized;
}

function serializeFetchPayload(payload: unknown): unknown {
  if (payload instanceof Uint8Array) {
    return {
      kind: 'bytes',
      data_b64: toBase64(payload),
    };
  }

  if (payload === undefined) {
    return {
      kind: 'undefined',
    };
  }

  return payload;
}

async function snapshotWorldState(
  vfs: VFS,
  memory: SimpleMemory,
): Promise<{ files: SerializedWorldStateFileEntry[]; memory: SerializedMemoryItem[] }> {
  return {
    files: await snapshotVfsEntries(vfs),
    memory: snapshotMemoryItems(memory),
  };
}

async function snapshotVfsEntries(vfs: VFS): Promise<SerializedWorldStateFileEntry[]> {
  const entries: SerializedWorldStateFileEntry[] = [];

  async function walk(dirPath: string): Promise<void> {
    const children = await vfs.listdir(dirPath);
    for (const child of children) {
      const isDir = child.endsWith('/');
      const name = isDir ? child.slice(0, -1) : child;
      const fullPath = dirPath === '/' ? `/${name}` : `${dirPath}/${name}`;

      if (isDir) {
        entries.push({
          path: fullPath,
          kind: 'dir',
        });
        await walk(fullPath);
        continue;
      }

      const data = await vfs.readBytes(fullPath);
      if (looksBinary(data)) {
        entries.push({
          path: fullPath,
          kind: 'bytes',
          data_b64: toBase64(data),
        });
      } else {
        entries.push({
          path: fullPath,
          kind: 'text',
          text: textDecoder.decode(data),
        });
      }
    }
  }

  await walk('/');
  return entries;
}

function snapshotMemoryItems(memory: SimpleMemory): SerializedMemoryItem[] {
  return memory
    .recent(Number.MAX_SAFE_INTEGER)
    .slice()
    .reverse()
    .map(function (item) {
      return {
        id: item.id,
        text: item.text,
        createdEpochMs: item.createdEpochMs,
        metadata: item.metadata,
      };
    });
}

function serializeCommandResult(result: CommandResult): SerializedCommandResult {
  return {
    stdout_b64: toBase64(result.stdout),
    ...(looksBinary(result.stdout) || result.stdout.length === 0
      ? {}
      : { stdout_text: textDecoder.decode(result.stdout) }),
    stderr: result.stderr,
    exitCode: result.exitCode,
    contentType: result.contentType,
  };
}

function serializeRunExecution(execution: RunExecution): Record<string, unknown> {
  return {
    exitCode: execution.exitCode,
    stdout_b64: toBase64(execution.stdout),
    ...(looksBinary(execution.stdout) || execution.stdout.length === 0
      ? {}
      : { stdout_text: textDecoder.decode(execution.stdout) }),
    stderr: execution.stderr,
    contentType: execution.contentType,
    trace: execution.trace.map(serializePipelineExecutionTrace),
    presentation: {
      text: normalizePresentationText(execution.presentation.text),
      body: execution.presentation.body,
      stdoutMode: execution.presentation.stdoutMode,
      ...(execution.presentation.savedPath === undefined ? {} : { savedPath: execution.presentation.savedPath }),
      ...(execution.presentation.totalBytes === undefined ? {} : { totalBytes: execution.presentation.totalBytes }),
      ...(execution.presentation.totalLines === undefined ? {} : { totalLines: execution.presentation.totalLines }),
    },
  };
}

function serializePipelineExecutionTrace(trace: PipelineExecutionTrace): Record<string, unknown> {
  return {
    relationFromPrevious: trace.relationFromPrevious,
    executed: trace.executed,
    ...(trace.skippedReason === undefined ? {} : { skippedReason: trace.skippedReason }),
    ...(trace.exitCode === undefined ? {} : { exitCode: trace.exitCode }),
    commands: trace.commands.map(function (commandTrace) {
      return {
        argv: [...commandTrace.argv],
        stdinBytes: commandTrace.stdinBytes,
        stdoutBytes: commandTrace.stdoutBytes,
        stderr: commandTrace.stderr,
        exitCode: commandTrace.exitCode,
        contentType: commandTrace.contentType,
      };
    }),
  };
}

function serializeScenarioSpec(scenario: ScenarioSpec): Record<string, unknown> {
  return {
    id: scenario.id,
    category: scenario.category,
    description: scenario.description,
    prompt: scenario.prompt,
    ...(scenario.promptVariant === undefined ? {} : { promptVariant: scenario.promptVariant }),
    maxTurns: scenario.maxTurns,
    maxToolCalls: scenario.maxToolCalls,
    ...(scenario.repeats === undefined ? {} : { repeats: scenario.repeats }),
    world: serializeSnapshotWorld(scenario.world as SnapshotWorld),
    ...(scenario.oracle === undefined ? {} : { oracle: scenario.oracle }),
    assertions: scenario.assertions,
  };
}

function serializeOracleTrace(trace: Awaited<ReturnType<typeof runOracle>>): Record<string, unknown> {
  return {
    scenarioId: trace.scenarioId,
    steps: trace.steps.map(function (step) {
      return {
        command: step.command,
        output: normalizePresentationText(step.output),
        body: step.body,
        exitCode: step.exitCode,
        expectedExitCode: step.expectedExitCode,
        execution: serializeRunExecution(step.execution),
      };
    }),
    finalOutput: normalizePresentationText(trace.finalOutput),
    finalBody: trace.finalBody,
    finalExitCode: trace.finalExitCode,
  };
}

function serializeExecutionPolicy(policy: AgentCLIExecutionPolicy): Record<string, unknown> {
  return {
    ...(policy.maxMaterializedBytes === undefined ? {} : { maxMaterializedBytes: policy.maxMaterializedBytes }),
  };
}

function serializeVfsResourcePolicy(policy: VfsResourcePolicy): Record<string, unknown> {
  return {
    ...(policy.maxFileBytes === undefined ? {} : { maxFileBytes: policy.maxFileBytes }),
    ...(policy.maxTotalBytes === undefined ? {} : { maxTotalBytes: policy.maxTotalBytes }),
    ...(policy.maxDirectoryDepth === undefined ? {} : { maxDirectoryDepth: policy.maxDirectoryDepth }),
    ...(policy.maxEntriesPerDirectory === undefined
      ? {}
      : { maxEntriesPerDirectory: policy.maxEntriesPerDirectory }),
    ...(policy.maxOutputArtifactBytes === undefined
      ? {}
      : { maxOutputArtifactBytes: policy.maxOutputArtifactBytes }),
  };
}

function isSnapshotDirectoryEntry(value: SnapshotFileEntry): value is SnapshotDirectoryEntry {
  return typeof value === 'object' && !(value instanceof Uint8Array) && value.kind === 'dir';
}

function captureParserError(testCase: ParserErrorCase): string {
  try {
    if (testCase.stage === 'tokenize') {
      tokenizeCommandLine(testCase.input);
    } else {
      parseCommandLine(testCase.input);
    }
  } catch (caught) {
    if (caught instanceof ParseError) {
      return caught.message;
    }
    if (caught instanceof Error) {
      return caught.message;
    }
    return String(caught);
  }

  throw new Error(`expected parser error for ${testCase.input}`);
}

function snapshotPathUtilsCase(testCase: PathUtilsCase): Record<string, unknown> {
  switch (testCase.kind) {
    case 'normalize':
      return {
        kind: testCase.kind,
        input: testCase.input,
        output: posixNormalize(testCase.input!),
      };
    case 'parentOf':
      return {
        kind: testCase.kind,
        input: testCase.input,
        output: parentOf(testCase.input!),
      };
    case 'baseName':
      return {
        kind: testCase.kind,
        input: testCase.input,
        output: baseName(testCase.input!),
      };
    case 'isStrictDescendantPath':
      return {
        kind: testCase.kind,
        ancestor: testCase.ancestor,
        candidate: testCase.candidate,
        output: isStrictDescendantPath(testCase.ancestor!, testCase.candidate!),
      };
    default: {
      const _never: never = testCase.kind;
      return _never;
    }
  }
}

async function snapshotMemoryVfsCase(testCase: MemoryVfsCase): Promise<Record<string, unknown>> {
  const vfs = new MemoryVFS(
    testCase.resourcePolicy === undefined ? {} : { resourcePolicy: testCase.resourcePolicy },
  );
  const steps: MemoryVfsStepSnapshot[] = [];

  for (const step of testCase.steps) {
    steps.push(await runMemoryVfsStep(vfs, step));
  }

  return {
    id: testCase.id,
    ...(testCase.resourcePolicy === undefined ? {} : { resourcePolicy: testCase.resourcePolicy }),
    steps,
  };
}

async function runMemoryVfsStep(vfs: MemoryVFS, step: MemoryVfsStep): Promise<MemoryVfsStepSnapshot> {
  const base: MemoryVfsStepSnapshot = {
    op: step.op,
    ...(step.path === undefined ? {} : { path: step.path }),
    ...(step.src === undefined ? {} : { src: step.src }),
    ...(step.dst === undefined ? {} : { dst: step.dst }),
    ...(step.parents === undefined ? {} : { parents: step.parents }),
    ...(step.data === undefined ? {} : { data_b64: toBase64(step.data) }),
  };

  try {
    switch (step.op) {
      case 'writeBytes':
        return {
          ...base,
          result: await vfs.writeBytes(step.path!, step.data!, step.parents),
        };
      case 'appendBytes':
        return {
          ...base,
          result: await vfs.appendBytes(step.path!, step.data!, step.parents),
        };
      case 'mkdir':
        return {
          ...base,
          result: await vfs.mkdir(step.path!, step.parents),
        };
      case 'listdir':
        return {
          ...base,
          result: await vfs.listdir(step.path),
        };
      case 'readBytes':
        return {
          ...base,
          result: toBase64(await vfs.readBytes(step.path!)),
        };
      case 'readText':
        return {
          ...base,
          result: await vfs.readText(step.path!),
        };
      case 'delete':
        return {
          ...base,
          result: await vfs.delete(step.path!),
        };
      case 'copy':
        return {
          ...base,
          result: await vfs.copy(step.src!, step.dst!),
        };
      case 'move':
        return {
          ...base,
          result: await vfs.move(step.src!, step.dst!),
        };
      case 'exists':
        return {
          ...base,
          result: await vfs.exists(step.path!),
        };
      case 'isDir':
        return {
          ...base,
          result: await vfs.isDir(step.path!),
        };
      case 'stat':
        return {
          ...base,
          result: await vfs.stat(step.path!),
        };
      default: {
        const _never: never = step.op;
        return _never;
      }
    }
  } catch (caught) {
    const vfsError = toVfsError(caught);
    if (!vfsError) {
      throw caught;
    }
    return {
      ...base,
      error: {
        code: vfsError.code,
        path: vfsError.path,
        ...(vfsError.targetPath === undefined ? {} : { targetPath: vfsError.targetPath }),
        ...(vfsError.details === undefined ? {} : { details: vfsError.details }),
        message: vfsError.message,
      },
    };
  }
}

function snapshotArithmeticCase(testCase: ArithmeticCase): Record<string, unknown> {
  try {
    return {
      expression: testCase.expression,
      result: safeEvalArithmetic(testCase.expression),
    };
  } catch (caught) {
    return {
      expression: testCase.expression,
      error: caught instanceof Error ? caught.message : String(caught),
    };
  }
}

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeJsonl(filePath: string, rows: unknown[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const contents =
    rows
      .map(function (row) {
        return JSON.stringify(row);
      })
      .join('\n') + '\n';
  await writeFile(filePath, contents, 'utf8');
}

function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

function normalizePresentationText(text: string): string {
  return text.replace(/\[exit:(-?\d+) \| [^\]]+\]$/, '[exit:$1 | 0ms]');
}

function encodeText(value: string): Uint8Array {
  return textEncoder.encode(value);
}

async function withMockedNow<T>(run: () => Promise<T>): Promise<T> {
  const originalNow = Date.now;
  let current = 1_700_000_000_000;

  Date.now = function (): number {
    current += 1;
    return current;
  };

  try {
    return await run();
  } finally {
    Date.now = originalNow;
  }
}

main().catch(function (caught) {
  console.error(errorMessage(caught));
  process.exitCode = 1;
});
