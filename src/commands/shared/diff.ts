import { textEncoder } from '../../types.js';
import { compareCLocaleText, errorMessage, foldAsciiCaseText, looksBinary } from '../../utils.js';
import type { VFileInfo } from '../../vfs/interface.js';
import type { CommandContext } from '../core.js';
import { materializedLimitError } from './io.js';
import { createByteLineModel, type ByteLineModel } from './line-model.js';

export interface ParsedDiffCommand {
  format: 'normal' | 'unified' | 'context';
  contextLines: number;
  recursive: boolean;
  forceText: boolean;
  ignoreSpaceChange: boolean;
  ignoreCase: boolean;
  left: string;
  right: string;
}

export interface DiffExecutionResult {
  stdout: Uint8Array;
  stderr: string;
  exitCode: number;
  contentType: string;
}

interface DiffFile {
  kind: 'file';
  displayName: string;
  loadBytes(): Promise<Uint8Array>;
  modifiedEpochMs: number;
}

interface DiffDirectory {
  kind: 'dir';
  displayName: string;
  normalizedPath: string;
}

type DiffTarget = DiffFile | DiffDirectory;

interface ResolvedDiffPair {
  left: DiffTarget;
  right: DiffTarget;
}

type DiffParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

type DiffOp =
  | { kind: 'equal'; leftIndex: number; rightIndex: number; leftNumber: number; rightNumber: number }
  | { kind: 'delete'; leftIndex: number; leftNumber: number; rightNumber: number }
  | { kind: 'insert'; rightIndex: number; leftNumber: number; rightNumber: number };

interface DiffChangeGroup {
  leftStart: number;
  rightStart: number;
  leftIndexes: number[];
  rightIndexes: number[];
}

interface DiffHunk {
  operations: DiffOp[];
}

export function parseDiffArgs(args: string[]): DiffParseResult<ParsedDiffCommand> {
  let format: ParsedDiffCommand['format'] = 'normal';
  let contextLines = 3;
  let recursive = false;
  let forceText = false;
  let ignoreSpaceChange = false;
  let ignoreCase = false;
  let parsingOptions = true;
  const operands: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (parsingOptions && arg === '--') {
      parsingOptions = false;
      continue;
    }

    if (parsingOptions && arg.startsWith('--')) {
      const long = parseLongDiffOption(arg);
      if (!long.ok) {
        return long;
      }
      if (long.value.consumeNext) {
        index += 1;
      }
      format = long.value.format ?? format;
      contextLines = long.value.contextLines ?? contextLines;
      recursive = long.value.recursive ?? recursive;
      forceText = long.value.forceText ?? forceText;
      ignoreSpaceChange = long.value.ignoreSpaceChange ?? ignoreSpaceChange;
      ignoreCase = long.value.ignoreCase ?? ignoreCase;
      continue;
    }

    if (parsingOptions && arg.startsWith('-') && arg !== '-') {
      const short = parseShortDiffOption(arg, args[index + 1]);
      if (!short.ok) {
        return short;
      }
      if (short.value.consumeNext) {
        index += 1;
      }
      format = short.value.format ?? format;
      contextLines = short.value.contextLines ?? contextLines;
      recursive = short.value.recursive ?? recursive;
      forceText = short.value.forceText ?? forceText;
      ignoreSpaceChange = short.value.ignoreSpaceChange ?? ignoreSpaceChange;
      ignoreCase = short.value.ignoreCase ?? ignoreCase;
      continue;
    }

    operands.push(arg);
    parsingOptions = false;
  }

  if (operands.length !== 2) {
    return {
      ok: false,
      error: 'usage: diff [-u|-U N|-c|-C N] [-r] [-a] [-b] [-i] <left> <right>',
    };
  }

  return {
    ok: true,
    value: {
      format,
      contextLines,
      recursive,
      forceText,
      ignoreSpaceChange,
      ignoreCase,
      left: operands[0]!,
      right: operands[1]!,
    },
  };
}

export async function runDiffCommand(
  ctx: CommandContext,
  parsed: ParsedDiffCommand,
  stdin: Uint8Array,
): Promise<DiffExecutionResult> {
  const resolved = await resolveDiffPair(ctx, parsed.left, parsed.right, stdin);
  if (!resolved.ok) {
    return resolved.error;
  }

  if (resolved.value.left.kind === 'dir' && resolved.value.right.kind === 'dir') {
    return compareDirectories(ctx, resolved.value.left, resolved.value.right, parsed, stdin);
  }

  if (resolved.value.left.kind !== 'file' || resolved.value.right.kind !== 'file') {
    return diffFailure('diff: internal error: mismatched diff targets');
  }

  return compareFiles(resolved.value.left, resolved.value.right, parsed);
}

async function resolveDiffPair(
  ctx: CommandContext,
  leftArg: string,
  rightArg: string,
  stdin: Uint8Array,
): Promise<{ ok: true; value: ResolvedDiffPair } | { ok: false; error: DiffExecutionResult }> {
  const left = await resolveDiffTarget(ctx, leftArg, stdin);
  if (!left.ok) {
    return left;
  }

  const right = await resolveDiffTarget(ctx, rightArg, stdin);
  if (!right.ok) {
    return right;
  }

  if (left.value.kind === 'dir' && right.value.kind === 'file' && rightArg !== '-') {
    return resolveDirFilePair(ctx, left.value, rightArg, stdin, true);
  }
  if (left.value.kind === 'file' && right.value.kind === 'dir' && leftArg !== '-') {
    return resolveDirFilePair(ctx, right.value, leftArg, stdin, false);
  }
  if (left.value.kind === 'dir' && right.value.kind === 'dir') {
    return {
      ok: true,
      value: {
        left: left.value,
        right: right.value,
      },
    };
  }

  if (left.value.kind === 'dir' || right.value.kind === 'dir') {
    return {
      ok: false,
      error: diffFailure('diff: cannot compare a directory against stdin', 2),
    };
  }

  return {
    ok: true,
    value: {
      left: left.value,
      right: right.value,
    },
  };
}

async function resolveDirFilePair(
  ctx: CommandContext,
  directory: DiffDirectory,
  fileArg: string,
  stdin: Uint8Array,
  directoryOnLeft: boolean,
): Promise<{ ok: true; value: ResolvedDiffPair } | { ok: false; error: DiffExecutionResult }> {
  const candidatePath =
    directory.normalizedPath === '/'
      ? `/${baseName(fileArg)}`
      : `${directory.normalizedPath}/${baseName(fileArg)}`;
  const candidate = await resolveDiffTarget(ctx, candidatePath, stdin);
  if (!candidate.ok) {
    const candidateLabel = ctx.vfs.normalize(candidatePath);
    return {
      ok: false,
      error: diffFailure(`diff: ${candidateLabel}: No such file or directory`, 2),
    };
  }

  if (candidate.value.kind !== 'file') {
    return {
      ok: false,
      error: diffFailure(`diff: ${candidate.value.displayName}: Is a directory`, 2),
    };
  }

  return {
    ok: true,
    value: directoryOnLeft
      ? {
          left: candidate.value,
          right: await fileTargetFromArg(ctx, fileArg, stdin),
        }
      : {
          left: await fileTargetFromArg(ctx, fileArg, stdin),
          right: candidate.value,
        },
  };
}

async function fileTargetFromArg(ctx: CommandContext, arg: string, stdin: Uint8Array): Promise<DiffFile> {
  const resolved = await resolveDiffTarget(ctx, arg, stdin);
  if (!resolved.ok || resolved.value.kind !== 'file') {
    throw new Error(`expected file target: ${arg}`);
  }
  return resolved.value;
}

async function resolveDiffTarget(
  ctx: CommandContext,
  arg: string,
  stdin: Uint8Array,
): Promise<{ ok: true; value: DiffTarget } | { ok: false; error: DiffExecutionResult }> {
  if (arg === '-') {
    return {
      ok: true,
      value: {
        kind: 'file',
        displayName: '-',
        modifiedEpochMs: 0,
        async loadBytes(): Promise<Uint8Array> {
          const limitError = materializedLimitError(ctx, 'diff', 'stdin', stdin.length);
          if (limitError !== undefined) {
            throw new Error(limitError.stderr);
          }
          return new Uint8Array(stdin);
        },
      },
    };
  }

  let info: VFileInfo;
  try {
    info = await ctx.vfs.stat(arg);
  } catch (caught) {
    return {
      ok: false,
      error: diffFailure(formatDiffFailureMessage(caught), 2),
    };
  }

  if (!info.exists) {
    return {
      ok: false,
      error: diffFailure(`diff: ${ctx.vfs.normalize(arg)}: No such file or directory`, 2),
    };
  }

  if (info.isDir) {
    return {
      ok: true,
      value: {
        kind: 'dir',
        displayName: info.path,
        normalizedPath: info.path,
      },
    };
  }

  return {
    ok: true,
    value: {
      kind: 'file',
      displayName: info.path,
      modifiedEpochMs: info.modifiedEpochMs,
      async loadBytes(): Promise<Uint8Array> {
        const limitError = materializedLimitError(ctx, 'diff', info.path, info.size);
        if (limitError !== undefined) {
          throw new Error(limitError.stderr);
        }
        return ctx.vfs.readBytes(info.path);
      },
    },
  };
}

async function compareDirectories(
  ctx: CommandContext,
  left: DiffDirectory,
  right: DiffDirectory,
  parsed: ParsedDiffCommand,
  stdin: Uint8Array,
): Promise<DiffExecutionResult> {
  const leftEntries = await listDirectoryEntries(ctx, left.normalizedPath);
  const rightEntries = await listDirectoryEntries(ctx, right.normalizedPath);
  const names = [...new Set([...leftEntries.keys(), ...rightEntries.keys()])].sort(function (a, b) {
    return compareCLocaleText(a, b);
  });
  const directoryDiffPrefix = buildDirectoryDiffPrefix(parsed);
  const chunks: Uint8Array[] = [];
  let exitCode = 0;

  for (const name of names) {
    const leftEntry = leftEntries.get(name);
    const rightEntry = rightEntries.get(name);

    if (leftEntry === undefined) {
      exitCode = 1;
      chunks.push(textEncoder.encode(`Only in ${right.displayName}: ${name}\n`));
      continue;
    }
    if (rightEntry === undefined) {
      exitCode = 1;
      chunks.push(textEncoder.encode(`Only in ${left.displayName}: ${name}\n`));
      continue;
    }

    const leftPath = joinPath(left.displayName, name);
    const rightPath = joinPath(right.displayName, name);

    if (leftEntry.isDir && rightEntry.isDir) {
      if (parsed.recursive) {
        const nested = await compareDirectories(
          ctx,
          { kind: 'dir', displayName: leftPath, normalizedPath: leftEntry.path },
          { kind: 'dir', displayName: rightPath, normalizedPath: rightEntry.path },
          parsed,
          stdin,
        );
        if (nested.exitCode === 2) {
          return nested;
        }
        if (nested.exitCode === 1) {
          exitCode = 1;
        }
        if (nested.stdout.length > 0) {
          chunks.push(nested.stdout);
        }
      } else {
        exitCode = 1;
        chunks.push(textEncoder.encode(`Common subdirectories: ${leftPath} and ${rightPath}\n`));
      }
      continue;
    }

    if (leftEntry.isDir !== rightEntry.isDir) {
      exitCode = 1;
      const leftKind = leftEntry.isDir ? 'directory' : 'regular file';
      const rightKind = rightEntry.isDir ? 'directory' : 'regular file';
      chunks.push(
        textEncoder.encode(`File ${leftPath} is a ${leftKind} while file ${rightPath} is a ${rightKind}\n`),
      );
      continue;
    }

    const fileResult = await compareFiles(
      createDirectoryDiffFile(ctx, leftEntry, leftPath),
      createDirectoryDiffFile(ctx, rightEntry, rightPath),
      parsed,
      directoryDiffPrefix,
    );

    if (fileResult.exitCode === 2) {
      return fileResult;
    }
    if (fileResult.exitCode === 1) {
      exitCode = 1;
      chunks.push(fileResult.stdout);
    }
  }

  return {
    stdout: concatBytes(chunks),
    stderr: '',
    exitCode,
    contentType: 'text/plain',
  };
}

async function compareFiles(
  left: DiffFile,
  right: DiffFile,
  parsed: ParsedDiffCommand,
  directoryDiffPrefix?: string,
): Promise<DiffExecutionResult> {
  let leftBytes: Uint8Array;
  let rightBytes: Uint8Array;

  try {
    leftBytes = await left.loadBytes();
    rightBytes = await right.loadBytes();
  } catch (caught) {
    return diffFailure(formatDiffFailureMessage(caught), 2);
  }

  if (sameBytes(leftBytes, rightBytes)) {
    return diffSuccess(new Uint8Array(), 0);
  }

  if (!parsed.forceText && (looksBinary(leftBytes) || looksBinary(rightBytes))) {
    return diffSuccess(
      textEncoder.encode(`Binary files ${left.displayName} and ${right.displayName} differ\n`),
      1,
    );
  }

  const leftModel = createByteLineModel(leftBytes);
  const rightModel = createByteLineModel(rightBytes);
  const operations = diffOperations(leftModel, rightModel, parsed);
  const differs = operations.some(function (operation) {
    return operation.kind !== 'equal';
  });

  if (!differs) {
    return diffSuccess(new Uint8Array(), 0);
  }

  const body = renderDiffBody(left, right, leftModel, rightModel, operations, parsed, directoryDiffPrefix);

  return diffSuccess(body, 1, looksBinary(body) ? 'application/octet-stream' : 'text/plain');
}

function diffOperations(left: ByteLineModel, right: ByteLineModel, parsed: ParsedDiffCommand): DiffOp[] {
  const leftKeys = left.lines.map(function (line) {
    return normalizeDiffLine(line.text, parsed);
  });
  const rightKeys = right.lines.map(function (line) {
    return normalizeDiffLine(line.text, parsed);
  });
  const matrix = buildLcsMatrix(leftKeys, rightKeys);
  const rawOps: Array<{ kind: 'equal' | 'delete' | 'insert'; leftIndex?: number; rightIndex?: number }> = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < leftKeys.length || rightIndex < rightKeys.length) {
    if (
      leftIndex < leftKeys.length &&
      rightIndex < rightKeys.length &&
      leftKeys[leftIndex] === rightKeys[rightIndex]
    ) {
      rawOps.push({ kind: 'equal', leftIndex, rightIndex });
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    if (
      rightIndex >= rightKeys.length ||
      (leftIndex < leftKeys.length &&
        matrix[leftIndex + 1]![rightIndex]! >= matrix[leftIndex]![rightIndex + 1]!)
    ) {
      rawOps.push({ kind: 'delete', leftIndex });
      leftIndex += 1;
      continue;
    }

    rawOps.push({ kind: 'insert', rightIndex });
    rightIndex += 1;
  }

  return annotateDiffOps(rawOps);
}

function buildLcsMatrix(left: string[], right: string[]): number[][] {
  const matrix = Array.from({ length: left.length + 1 }, function () {
    return Array<number>(right.length + 1).fill(0);
  });

  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      if (left[leftIndex] === right[rightIndex]) {
        matrix[leftIndex]![rightIndex] = matrix[leftIndex + 1]![rightIndex + 1]! + 1;
      } else {
        matrix[leftIndex]![rightIndex] = Math.max(
          matrix[leftIndex + 1]![rightIndex]!,
          matrix[leftIndex]![rightIndex + 1]!,
        );
      }
    }
  }

  return matrix;
}

function annotateDiffOps(
  operations: Array<{ kind: 'equal' | 'delete' | 'insert'; leftIndex?: number; rightIndex?: number }>,
): DiffOp[] {
  const annotated: DiffOp[] = [];
  let leftNumber = 1;
  let rightNumber = 1;

  for (const operation of operations) {
    if (operation.kind === 'equal') {
      annotated.push({
        kind: 'equal',
        leftIndex: operation.leftIndex!,
        rightIndex: operation.rightIndex!,
        leftNumber,
        rightNumber,
      });
      leftNumber += 1;
      rightNumber += 1;
      continue;
    }

    if (operation.kind === 'delete') {
      annotated.push({
        kind: 'delete',
        leftIndex: operation.leftIndex!,
        leftNumber,
        rightNumber,
      });
      leftNumber += 1;
      continue;
    }

    annotated.push({
      kind: 'insert',
      rightIndex: operation.rightIndex!,
      leftNumber,
      rightNumber,
    });
    rightNumber += 1;
  }

  return annotated;
}

function renderNormalDiff(
  leftName: string,
  rightName: string,
  left: ByteLineModel,
  right: ByteLineModel,
  operations: DiffOp[],
  directoryDiffPrefix: string | undefined,
): Uint8Array {
  const groups = collectChangeGroups(operations);
  const chunks: Uint8Array[] = [];

  if (directoryDiffPrefix !== undefined) {
    chunks.push(textEncoder.encode(`${directoryDiffPrefix} ${leftName} ${rightName}\n`));
  }

  for (const group of groups) {
    if (group.leftIndexes.length > 0 && group.rightIndexes.length > 0) {
      chunks.push(
        textEncoder.encode(
          `${formatNormalRange(group.leftStart, group.leftIndexes.length)}c${formatNormalRange(group.rightStart, group.rightIndexes.length)}\n`,
        ),
      );
      emitLines(chunks, left, group.leftIndexes, '< ');
      chunks.push(textEncoder.encode('---\n'));
      emitLines(chunks, right, group.rightIndexes, '> ');
      continue;
    }

    if (group.leftIndexes.length > 0) {
      chunks.push(
        textEncoder.encode(
          `${formatNormalRange(group.leftStart, group.leftIndexes.length)}d${group.rightStart - 1}\n`,
        ),
      );
      emitLines(chunks, left, group.leftIndexes, '< ');
      continue;
    }

    chunks.push(
      textEncoder.encode(
        `${group.leftStart - 1}a${formatNormalRange(group.rightStart, group.rightIndexes.length)}\n`,
      ),
    );
    emitLines(chunks, right, group.rightIndexes, '> ');
  }

  return concatBytes(chunks);
}

function renderUnifiedDiff(
  left: DiffFile,
  right: DiffFile,
  leftModel: ByteLineModel,
  rightModel: ByteLineModel,
  operations: DiffOp[],
  contextLines: number,
  directoryDiffPrefix: string | undefined,
): Uint8Array {
  const hunks = buildDiffHunks(operations, contextLines);
  const chunks: Uint8Array[] = [];

  if (directoryDiffPrefix !== undefined) {
    chunks.push(textEncoder.encode(`${directoryDiffPrefix} ${left.displayName} ${right.displayName}\n`));
  }

  chunks.push(
    textEncoder.encode(`--- ${left.displayName}\t${formatUnifiedTimestamp(left.modifiedEpochMs)}\n`),
  );
  chunks.push(
    textEncoder.encode(`+++ ${right.displayName}\t${formatUnifiedTimestamp(right.modifiedEpochMs)}\n`),
  );

  for (const hunk of hunks) {
    const leftRange = hunkRange(hunk.operations, 'left');
    const rightRange = hunkRange(hunk.operations, 'right');
    chunks.push(
      textEncoder.encode(
        `@@ -${formatUnifiedRange(leftRange.start, leftRange.count)} +${formatUnifiedRange(rightRange.start, rightRange.count)} @@\n`,
      ),
    );

    for (const operation of hunk.operations) {
      if (operation.kind === 'equal') {
        emitLine(chunks, leftModel, operation.leftIndex, ' ');
        continue;
      }
      if (operation.kind === 'delete') {
        emitLine(chunks, leftModel, operation.leftIndex, '-');
        continue;
      }
      emitLine(chunks, rightModel, operation.rightIndex, '+');
    }
  }

  return concatBytes(chunks);
}

function renderContextDiff(
  left: DiffFile,
  right: DiffFile,
  leftModel: ByteLineModel,
  rightModel: ByteLineModel,
  operations: DiffOp[],
  contextLines: number,
  directoryDiffPrefix: string | undefined,
): Uint8Array {
  const hunks = buildDiffHunks(operations, contextLines);
  const chunks: Uint8Array[] = [];

  if (directoryDiffPrefix !== undefined) {
    chunks.push(textEncoder.encode(`${directoryDiffPrefix} ${left.displayName} ${right.displayName}\n`));
  }

  chunks.push(
    textEncoder.encode(`*** ${left.displayName}\t${formatContextTimestamp(left.modifiedEpochMs)}\n`),
  );
  chunks.push(
    textEncoder.encode(`--- ${right.displayName}\t${formatContextTimestamp(right.modifiedEpochMs)}\n`),
  );

  for (const hunk of hunks) {
    const leftRange = hunkRange(hunk.operations, 'left');
    const rightRange = hunkRange(hunk.operations, 'right');
    const changeBlocks = groupHunkChanges(hunk.operations);

    chunks.push(textEncoder.encode('***************\n'));
    chunks.push(textEncoder.encode(`*** ${formatContextRange(leftRange.start, leftRange.count)} ****\n`));
    emitContextSide(chunks, leftModel, changeBlocks, true);
    chunks.push(textEncoder.encode(`--- ${formatContextRange(rightRange.start, rightRange.count)} ----\n`));
    emitContextSide(chunks, rightModel, changeBlocks, false);
  }

  return concatBytes(chunks);
}

function collectChangeGroups(operations: DiffOp[]): DiffChangeGroup[] {
  const groups: DiffChangeGroup[] = [];
  let current: DiffChangeGroup | undefined;

  for (const operation of operations) {
    if (operation.kind === 'equal') {
      if (current !== undefined) {
        groups.push(current);
        current = undefined;
      }
      continue;
    }

    if (current === undefined) {
      current = {
        leftStart: operation.leftNumber,
        rightStart: operation.rightNumber,
        leftIndexes: [],
        rightIndexes: [],
      };
    }

    if (operation.kind === 'delete') {
      current.leftIndexes.push(operation.leftIndex);
    } else {
      current.rightIndexes.push(operation.rightIndex);
    }
  }

  if (current !== undefined) {
    groups.push(current);
  }

  return groups;
}

function buildDiffHunks(operations: DiffOp[], contextLines: number): DiffHunk[] {
  const changedIndexes = operations
    .map(function (operation, index) {
      return operation.kind === 'equal' ? -1 : index;
    })
    .filter(function (index) {
      return index >= 0;
    });

  if (changedIndexes.length === 0) {
    return [];
  }

  const hunks: DiffHunk[] = [];
  let start = Math.max(changedIndexes[0]! - contextLines, 0);
  let end = Math.min(changedIndexes[0]! + contextLines, operations.length - 1);

  for (const changedIndex of changedIndexes.slice(1)) {
    const nextStart = Math.max(changedIndex - contextLines, 0);
    const nextEnd = Math.min(changedIndex + contextLines, operations.length - 1);

    if (nextStart <= end + 1) {
      end = Math.max(end, nextEnd);
      continue;
    }

    hunks.push({ operations: operations.slice(start, end + 1) });
    start = nextStart;
    end = nextEnd;
  }

  hunks.push({ operations: operations.slice(start, end + 1) });
  return hunks;
}

function groupHunkChanges(operations: DiffOp[]): DiffHunk[] {
  const groups: DiffHunk[] = [];
  let current: DiffOp[] = [];

  for (const operation of operations) {
    if (operation.kind === 'equal') {
      if (current.length > 0) {
        groups.push({ operations: current });
        current = [];
      }
      groups.push({ operations: [operation] });
      continue;
    }
    current.push(operation);
  }

  if (current.length > 0) {
    groups.push({ operations: current });
  }

  return groups;
}

function emitContextSide(
  chunks: Uint8Array[],
  model: ByteLineModel,
  blocks: DiffHunk[],
  oldSide: boolean,
): void {
  for (const block of blocks) {
    const hasDelete = block.operations.some(function (operation) {
      return operation.kind === 'delete';
    });
    const hasInsert = block.operations.some(function (operation) {
      return operation.kind === 'insert';
    });

    for (const operation of block.operations) {
      if (operation.kind === 'equal') {
        emitLine(chunks, model, oldSide ? operation.leftIndex : operation.rightIndex, '  ');
        continue;
      }

      if (oldSide && operation.kind === 'delete') {
        emitLine(chunks, model, operation.leftIndex, hasInsert ? '! ' : '- ');
        continue;
      }
      if (!oldSide && operation.kind === 'insert') {
        emitLine(chunks, model, operation.rightIndex, hasDelete ? '! ' : '+ ');
      }
    }
  }
}

function emitLines(chunks: Uint8Array[], model: ByteLineModel, indexes: number[], prefix: string): void {
  for (const index of indexes) {
    emitLine(chunks, model, index, prefix);
  }
}

function emitLine(chunks: Uint8Array[], model: ByteLineModel, index: number, prefix: string): void {
  const line = model.lines[index]!;
  chunks.push(textEncoder.encode(prefix));
  chunks.push(line.bytes);
  chunks.push(textEncoder.encode('\n'));

  if (!model.endsWithNewline && index === model.lines.length - 1) {
    chunks.push(textEncoder.encode('\\ No newline at end of file\n'));
  }
}

function hunkRange(operations: DiffOp[], side: 'left' | 'right'): { start: number; count: number } {
  const consumed = operations.filter(function (operation) {
    return side === 'left' ? operation.kind !== 'insert' : operation.kind !== 'delete';
  });

  if (consumed.length === 0) {
    const first = operations[0]!;
    return {
      start: side === 'left' ? first.leftNumber : first.rightNumber,
      count: 0,
    };
  }

  const first = consumed[0]!;
  return {
    start: side === 'left' ? first.leftNumber : first.rightNumber,
    count: consumed.length,
  };
}

function normalizeDiffLine(text: string, parsed: ParsedDiffCommand): string {
  let normalized = text;

  if (parsed.ignoreSpaceChange) {
    normalized = normalized.replace(/[ \t]+/g, ' ');
  }
  if (parsed.ignoreCase) {
    normalized = foldAsciiCaseText(normalized);
  }

  return normalized;
}

function listDirectoryEntries(
  ctx: CommandContext,
  dirPath: string,
): Promise<Map<string, { isDir: boolean; path: string; modifiedEpochMs: number; size: number }>> {
  return ctx.vfs.listdir(dirPath).then(async function (entries) {
    const map = new Map<string, { isDir: boolean; path: string; modifiedEpochMs: number; size: number }>();

    for (const entry of entries) {
      const isDir = entry.endsWith('/');
      const name = isDir ? entry.slice(0, -1) : entry;
      const childPath = joinPath(dirPath, name);
      const info = await ctx.vfs.stat(childPath);
      map.set(name, {
        isDir,
        path: info.path,
        modifiedEpochMs: info.modifiedEpochMs,
        size: info.size,
      });
    }

    return map;
  });
}

function createDirectoryDiffFile(
  ctx: CommandContext,
  entry: { path: string; modifiedEpochMs: number; size: number },
  displayName: string,
): DiffFile {
  return {
    kind: 'file',
    displayName,
    modifiedEpochMs: entry.modifiedEpochMs,
    async loadBytes(): Promise<Uint8Array> {
      const limitError = materializedLimitError(ctx, 'diff', entry.path, entry.size);
      if (limitError !== undefined) {
        throw new Error(limitError.stderr);
      }
      return ctx.vfs.readBytes(entry.path);
    },
  };
}

function joinPath(basePath: string, name: string): string {
  return basePath === '/' ? `/${name}` : `${basePath}/${name}`;
}

function baseName(value: string): string {
  const normalized = value.replace(/\/+$/, '');
  const lastSlash = normalized.lastIndexOf('/');
  return lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
}

function parseLongDiffOption(arg: string): DiffParseResult<{
  consumeNext: boolean;
  format?: ParsedDiffCommand['format'];
  contextLines?: number;
  recursive?: boolean;
  forceText?: boolean;
  ignoreSpaceChange?: boolean;
  ignoreCase?: boolean;
}> {
  if (arg === '--recursive') {
    return { ok: true, value: { consumeNext: false, recursive: true } };
  }
  if (arg === '--text') {
    return { ok: true, value: { consumeNext: false, forceText: true } };
  }
  if (arg === '--ignore-space-change') {
    return { ok: true, value: { consumeNext: false, ignoreSpaceChange: true } };
  }
  if (arg === '--ignore-case') {
    return { ok: true, value: { consumeNext: false, ignoreCase: true } };
  }
  if (arg === '--unified') {
    return { ok: true, value: { consumeNext: false, format: 'unified', contextLines: 3 } };
  }
  if (arg.startsWith('--unified=')) {
    const count = parseContextCount(arg.slice('--unified='.length));
    return count.ok
      ? { ok: true, value: { consumeNext: false, format: 'unified', contextLines: count.value } }
      : count;
  }
  if (arg === '--context') {
    return { ok: true, value: { consumeNext: false, format: 'context', contextLines: 3 } };
  }
  if (arg.startsWith('--context=')) {
    const count = parseContextCount(arg.slice('--context='.length));
    return count.ok
      ? { ok: true, value: { consumeNext: false, format: 'context', contextLines: count.value } }
      : count;
  }

  return { ok: false, error: `unknown option: ${arg}` };
}

function parseShortDiffOption(
  arg: string,
  nextArg: string | undefined,
): DiffParseResult<{
  consumeNext: boolean;
  format?: ParsedDiffCommand['format'];
  contextLines?: number;
  recursive?: boolean;
  forceText?: boolean;
  ignoreSpaceChange?: boolean;
  ignoreCase?: boolean;
}> {
  if (arg === '-u') {
    return { ok: true, value: { consumeNext: false, format: 'unified', contextLines: 3 } };
  }
  if (arg === '-c') {
    return { ok: true, value: { consumeNext: false, format: 'context', contextLines: 3 } };
  }
  if (arg === '-r') {
    return { ok: true, value: { consumeNext: false, recursive: true } };
  }
  if (arg === '-a') {
    return { ok: true, value: { consumeNext: false, forceText: true } };
  }
  if (arg === '-b') {
    return { ok: true, value: { consumeNext: false, ignoreSpaceChange: true } };
  }
  if (arg === '-i') {
    return { ok: true, value: { consumeNext: false, ignoreCase: true } };
  }
  if (arg === '-U' || arg === '-C') {
    if (nextArg === undefined) {
      return { ok: false, error: `missing value for ${arg}` };
    }
    const count = parseContextCount(nextArg);
    return count.ok
      ? {
          ok: true,
          value: {
            consumeNext: true,
            format: arg === '-U' ? 'unified' : 'context',
            contextLines: count.value,
          },
        }
      : count;
  }
  if (/^-[UC]\d+$/.test(arg)) {
    const format = arg[1] === 'U' ? 'unified' : 'context';
    const count = parseContextCount(arg.slice(2));
    return count.ok ? { ok: true, value: { consumeNext: false, format, contextLines: count.value } } : count;
  }

  return { ok: false, error: `unknown option: ${arg}` };
}

function parseContextCount(value: string): DiffParseResult<number> {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return { ok: false, error: `invalid context line count: ${value}` };
  }
  return { ok: true, value: parsed };
}

function buildDirectoryDiffPrefix(parsed: ParsedDiffCommand): string {
  const parts = ['diff'];
  if (parsed.recursive) {
    parts.push('-r');
  }
  if (parsed.forceText) {
    parts.push('-a');
  }
  if (parsed.ignoreSpaceChange) {
    parts.push('-b');
  }
  if (parsed.ignoreCase) {
    parts.push('-i');
  }
  if (parsed.format === 'unified') {
    parts.push(parsed.contextLines === 3 ? '-u' : `-U ${parsed.contextLines}`);
  }
  if (parsed.format === 'context') {
    parts.push(parsed.contextLines === 3 ? '-c' : `-C ${parsed.contextLines}`);
  }
  return parts.join(' ');
}

function renderDiffBody(
  left: DiffFile,
  right: DiffFile,
  leftModel: ByteLineModel,
  rightModel: ByteLineModel,
  operations: DiffOp[],
  parsed: ParsedDiffCommand,
  directoryDiffPrefix: string | undefined,
): Uint8Array {
  switch (parsed.format) {
    case 'normal':
      return renderNormalDiff(
        left.displayName,
        right.displayName,
        leftModel,
        rightModel,
        operations,
        directoryDiffPrefix,
      );
    case 'unified':
      return renderUnifiedDiff(
        left,
        right,
        leftModel,
        rightModel,
        operations,
        parsed.contextLines,
        directoryDiffPrefix,
      );
    case 'context':
      return renderContextDiff(
        left,
        right,
        leftModel,
        rightModel,
        operations,
        parsed.contextLines,
        directoryDiffPrefix,
      );
    default: {
      const _exhaustive: never = parsed.format;
      return _exhaustive;
    }
  }
}

function formatNormalRange(start: number, count: number): string {
  return count <= 1 ? String(start) : `${start},${start + count - 1}`;
}

function formatUnifiedRange(start: number, count: number): string {
  if (count === 0) {
    return `${start - 1},0`;
  }
  if (count === 1) {
    return String(start);
  }
  return `${start},${count}`;
}

function formatContextRange(start: number, count: number): string {
  if (count === 0) {
    return '0';
  }
  if (count === 1) {
    return String(start);
  }
  return `${start},${start + count - 1}`;
}

function formatUnifiedTimestamp(epochMs: number): string {
  const date = new Date(epochMs);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const millis = String(date.getMilliseconds()).padStart(3, '0');
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offsetHours = String(Math.floor(Math.abs(offsetMinutes) / 60)).padStart(2, '0');
  const offsetRemainder = String(Math.abs(offsetMinutes) % 60).padStart(2, '0');

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${millis} ${sign}${offsetHours}${offsetRemainder}`;
}

function formatContextTimestamp(epochMs: number): string {
  const date = new Date(epochMs);
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][date.getDay()]!;
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][
    date.getMonth()
  ]!;
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const year = date.getFullYear();

  return `${weekday} ${month} ${day} ${hours}:${minutes}:${seconds} ${year}`;
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function diffSuccess(stdout: Uint8Array, exitCode: number, contentType = 'text/plain'): DiffExecutionResult {
  return {
    stdout,
    stderr: '',
    exitCode,
    contentType,
  };
}

function diffFailure(stderr: string, exitCode = 2): DiffExecutionResult {
  return {
    stdout: new Uint8Array(),
    stderr,
    exitCode,
    contentType: 'text/plain',
  };
}

function formatDiffFailureMessage(caught: unknown): string {
  const message = errorMessage(caught);
  if (message.startsWith('diff: ')) {
    return message;
  }
  return `diff: ${message}`;
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
