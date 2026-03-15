import path from 'node:path';

import { ParseError, parseCommandLine, tokenizeCommandLine } from '../../src/parser.js';
import {
  errorMessage,
  formatDuration,
  formatSize,
  looksBinary,
  safeEvalArithmetic,
} from '../../src/utils.js';
import { toVfsError, type VfsErrorCode } from '../../src/vfs/errors.js';
import { MemoryVFS } from '../../src/vfs/memory-vfs.js';
import { baseName, isStrictDescendantPath, parentOf, posixNormalize } from '../../src/vfs/path-utils.js';
import { SNAPSHOT_ROOT, encodeText, toBase64, withMockedNow, writeJsonl } from './shared.js';

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

const textEncoder = new TextEncoder();

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
  { expression: '(-7) % 3' },
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

export async function writeParserSnapshots(): Promise<number> {
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

export async function writeVfsSnapshots(): Promise<number> {
  await writeJsonl(
    path.join(SNAPSHOT_ROOT, 'vfs', 'path-utils.jsonl'),
    PATH_UTILS_CASES.map(function (testCase) {
      return snapshotPathUtilsCase(testCase);
    }),
  );

  const memoryRows: unknown[] = [];
  for (const testCase of MEMORY_VFS_CASES) {
    memoryRows.push(
      await withMockedNow(async function (): Promise<unknown> {
        return snapshotMemoryVfsCase(testCase);
      }),
    );
  }

  await writeJsonl(path.join(SNAPSHOT_ROOT, 'vfs', 'memory-vfs.jsonl'), memoryRows);
  return PATH_UTILS_CASES.length + MEMORY_VFS_CASES.length;
}

export async function writeUtilsSnapshots(): Promise<number> {
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
      error: errorMessage(caught),
    };
  }
}
