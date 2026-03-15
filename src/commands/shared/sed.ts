import type { CommandResult } from '../../types.js';
import { err, ok, okBytes } from '../../types.js';
import { errorMessage, looksBinary, parentPath } from '../../utils.js';
import type { VFileInfo } from '../../vfs/interface.js';
import { formatEscapePathErrorMessage, formatResourceLimitErrorMessage } from '../../vfs/errors.js';
import type { CommandContext } from '../core.js';
import { blockingParentPath, errorCode, firstFileInPath } from './errors.js';
import { createByteLineModel, decodeCLocaleText, encodeCLocaleText } from './line-model.js';
import { materializedLimitError } from './io.js';

export interface ParsedSedProgram {
  quiet: boolean;
  extendedRegex: boolean;
  inPlaceSuffix: string | null;
  commands: SedCommand[];
  inputFiles: string[];
}

type SedParseResult<T> = { ok: true; value: T } | { ok: false; error: CommandResult };

type SedCommandKind = 'append' | 'insert' | 'change' | 'delete' | 'next' | 'print' | 'quit' | 'substitute';

type SedAddress =
  | { kind: 'line'; value: number }
  | { kind: 'last' }
  | { kind: 'regex'; source: string; regex: RegExp };

interface SedCommand {
  address1: SedAddress | undefined;
  address2: SedAddress | undefined;
  kind: SedCommandKind;
  text: string | undefined;
  substitute: SedSubstituteCommand | undefined;
}

interface SedSubstituteCommand {
  source: string;
  replacement: string;
  global: boolean;
  printOnSuccess: boolean;
  occurrence: number | undefined;
  ignoreCase: boolean;
  regex: RegExp;
}

interface SedCommandState {
  inRange: boolean;
}

interface SedInputFile {
  path: string | null;
  displayName: string;
  lines: SedInputLine[];
  originalBytes: Uint8Array;
}

interface SedInputLine {
  text: string;
  terminated: boolean;
}

interface SedStreamLine extends SedInputLine {
  fileIndex: number;
  lineIndex: number;
}

interface SedOutputRecord {
  text: string;
  terminated: boolean;
}

interface SedCycleLine {
  text: string;
  terminated: boolean;
  absoluteIndex: number;
  isLastLine: boolean;
}

interface SedCommandMatch {
  matched: boolean;
  startedRange: boolean;
}

export async function runSedCommand(
  ctx: CommandContext,
  args: string[],
  stdin: Uint8Array,
): Promise<CommandResult> {
  const parsed = await parseSedProgram(ctx, args);
  if (!parsed.ok) {
    return parsed.error;
  }

  const inputs = await loadSedInputs(ctx, parsed.value, stdin);
  if (!inputs.ok) {
    return inputs.error;
  }

  if (parsed.value.inPlaceSuffix !== null) {
    return applySedInPlace(ctx, parsed.value, inputs.value);
  }

  const output = executeSedProgram(parsed.value, inputs.value, false);
  if (!output.ok) {
    return output.error;
  }

  return okBytes(output.value, looksBinary(output.value) ? 'application/octet-stream' : 'text/plain');
}

async function parseSedProgram(
  ctx: CommandContext,
  args: string[],
): Promise<SedParseResult<ParsedSedProgram>> {
  let quiet = false;
  let extendedRegex = false;
  let inPlaceSuffix: string | null = null;
  let parsingOptions = true;
  let inlineScript: string | undefined;
  const scriptSources: string[] = [];
  const inputFiles: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (parsingOptions && arg === '--') {
      parsingOptions = false;
      continue;
    }

    if (parsingOptions && arg.startsWith('-') && arg !== '-') {
      const parsedOption = await parseSedOption(ctx, args, index, arg);
      if (!parsedOption.ok) {
        return parsedOption;
      }

      quiet = quiet || parsedOption.value.quiet;
      extendedRegex = extendedRegex || parsedOption.value.extendedRegex;

      if (parsedOption.value.inPlaceSuffix !== undefined) {
        inPlaceSuffix = parsedOption.value.inPlaceSuffix;
      }
      if (parsedOption.value.scriptSource !== undefined) {
        scriptSources.push(parsedOption.value.scriptSource);
      }
      index = parsedOption.value.nextIndex;
      continue;
    }

    if (inlineScript === undefined && scriptSources.length === 0) {
      inlineScript = arg;
      parsingOptions = false;
      continue;
    }

    inputFiles.push(arg);
    parsingOptions = false;
  }

  if (inlineScript !== undefined) {
    scriptSources.push(inlineScript);
  }

  if (scriptSources.length === 0) {
    return { ok: false, error: err('sed: missing script. Usage: sed [OPTION]... [SCRIPT] [INPUTFILE...]') };
  }

  const commands = parseSedCommands(scriptSources.join('\n'), extendedRegex);
  if (!commands.ok) {
    return { ok: false, error: err(`sed: ${commands.error}`) };
  }

  if (inPlaceSuffix !== null && inputFiles.length === 0) {
    return { ok: false, error: err('sed: -i requires at least one input file') };
  }

  if (inPlaceSuffix !== null && inputFiles.includes('-')) {
    return { ok: false, error: err('sed: cannot use -i with stdin') };
  }

  return {
    ok: true,
    value: {
      quiet,
      extendedRegex,
      inPlaceSuffix,
      commands: commands.value,
      inputFiles,
    },
  };
}

async function parseSedOption(
  ctx: CommandContext,
  args: string[],
  index: number,
  arg: string,
): Promise<
  SedParseResult<{
    nextIndex: number;
    quiet: boolean;
    extendedRegex: boolean;
    inPlaceSuffix?: string | null;
    scriptSource?: string;
  }>
> {
  if (arg === '-n') {
    return {
      ok: true,
      value: {
        nextIndex: index,
        quiet: true,
        extendedRegex: false,
      },
    };
  }

  if (arg === '-E') {
    return {
      ok: true,
      value: {
        nextIndex: index,
        quiet: false,
        extendedRegex: true,
      },
    };
  }

  if (arg === '-i') {
    return {
      ok: true,
      value: {
        nextIndex: index,
        quiet: false,
        extendedRegex: false,
        inPlaceSuffix: '',
      },
    };
  }

  if (arg.startsWith('-i') && arg.length > 2) {
    return {
      ok: true,
      value: {
        nextIndex: index,
        quiet: false,
        extendedRegex: false,
        inPlaceSuffix: arg.slice(2),
      },
    };
  }

  if (arg === '-e' || arg.startsWith('-e')) {
    const script = arg.length > 2 ? arg.slice(2) : args[index + 1];
    if (script === undefined) {
      return { ok: false, error: err('sed: missing script for -e') };
    }
    return {
      ok: true,
      value: {
        nextIndex: arg.length > 2 ? index : index + 1,
        quiet: false,
        extendedRegex: false,
        scriptSource: script,
      },
    };
  }

  if (arg === '-f' || arg.startsWith('-f')) {
    const scriptPath = arg.length > 2 ? arg.slice(2) : args[index + 1];
    if (scriptPath === undefined) {
      return { ok: false, error: err('sed: missing script file for -f') };
    }

    const loadedScript = await readSedScriptFile(ctx, scriptPath);
    if (!loadedScript.ok) {
      return loadedScript;
    }

    return {
      ok: true,
      value: {
        nextIndex: arg.length > 2 ? index : index + 1,
        quiet: false,
        extendedRegex: false,
        scriptSource: loadedScript.value,
      },
    };
  }

  return parseSedShortOptionCluster(ctx, args, index, arg);
}

async function parseSedShortOptionCluster(
  ctx: CommandContext,
  args: string[],
  index: number,
  arg: string,
): Promise<
  SedParseResult<{
    nextIndex: number;
    quiet: boolean;
    extendedRegex: boolean;
    inPlaceSuffix?: string | null;
    scriptSource?: string;
  }>
> {
  let quiet = false;
  let extendedRegex = false;
  let scanIndex = 1;

  while (scanIndex < arg.length) {
    const flag = arg[scanIndex]!;

    if (flag === 'n') {
      quiet = true;
      scanIndex += 1;
      continue;
    }

    if (flag === 'E') {
      extendedRegex = true;
      scanIndex += 1;
      continue;
    }

    if (flag === 'i') {
      return {
        ok: true,
        value: {
          nextIndex: index,
          quiet,
          extendedRegex,
          inPlaceSuffix: arg.slice(scanIndex + 1),
        },
      };
    }

    if (flag === 'e') {
      const scriptSource = arg.slice(scanIndex + 1) || args[index + 1];
      if (scriptSource === undefined) {
        return { ok: false, error: err('sed: missing script for -e') };
      }

      return {
        ok: true,
        value: {
          nextIndex: arg.slice(scanIndex + 1) ? index : index + 1,
          quiet,
          extendedRegex,
          scriptSource,
        },
      };
    }

    if (flag === 'f') {
      const scriptPath = arg.slice(scanIndex + 1) || args[index + 1];
      if (scriptPath === undefined) {
        return { ok: false, error: err('sed: missing script file for -f') };
      }

      const loadedScript = await readSedScriptFile(ctx, scriptPath);
      if (!loadedScript.ok) {
        return loadedScript;
      }

      return {
        ok: true,
        value: {
          nextIndex: arg.slice(scanIndex + 1) ? index : index + 1,
          quiet,
          extendedRegex,
          scriptSource: loadedScript.value,
        },
      };
    }

    return { ok: false, error: err(`sed: unknown option: -${flag}`) };
  }

  return {
    ok: true,
    value: {
      nextIndex: index,
      quiet,
      extendedRegex,
    },
  };
}

async function readSedScriptFile(ctx: CommandContext, filePath: string): Promise<SedParseResult<string>> {
  let info: VFileInfo;
  const normalized = ctx.vfs.normalize(filePath);

  try {
    info = await ctx.vfs.stat(filePath);
  } catch (caught) {
    return {
      ok: false,
      error: await formatSedPathError(ctx, 'sed', filePath, caught, 'script file not found'),
    };
  }

  if (!info.exists) {
    const blockedPath = await firstFileInPath(ctx, normalized);
    if (blockedPath !== null) {
      return {
        ok: false,
        error: err(`sed: parent is not a directory: ${blockedPath}`),
      };
    }
    return {
      ok: false,
      error: err(`sed: script file not found: ${normalized}. Use: ls ${parentPath(filePath)}`),
    };
  }
  if (info.isDir) {
    return {
      ok: false,
      error: err(`sed: script path is a directory: ${normalized}. Use: ls ${normalized}`),
    };
  }
  const limitError = materializedLimitError(ctx, 'sed', normalized, info.size);
  if (limitError !== undefined) {
    return { ok: false, error: limitError };
  }

  try {
    return { ok: true, value: decodeCLocaleText(await ctx.vfs.readBytes(filePath)) };
  } catch (caught) {
    return {
      ok: false,
      error: await formatSedPathError(ctx, 'sed', filePath, caught, 'script file not found'),
    };
  }
}

function parseSedCommands(
  source: string,
  extendedRegex: boolean,
): { ok: true; value: SedCommand[] } | { ok: false; error: string } {
  const commands: SedCommand[] = [];
  let index = 0;

  while (index < source.length) {
    index = skipSedSeparators(source, index);
    if (index >= source.length) {
      break;
    }

    const parsedCommand = parseSedCommand(source, index, extendedRegex);
    if (!parsedCommand.ok) {
      return parsedCommand;
    }

    commands.push(parsedCommand.value.command);
    index = parsedCommand.value.nextIndex;
  }

  if (commands.length === 0) {
    return { ok: false, error: 'empty script' };
  }

  return { ok: true, value: commands };
}

function parseSedCommand(
  source: string,
  startIndex: number,
  extendedRegex: boolean,
): { ok: true; value: { command: SedCommand; nextIndex: number } } | { ok: false; error: string } {
  let index = startIndex;
  const address1 = parseSedAddress(source, index, extendedRegex);
  let firstAddress: SedAddress | undefined;
  let secondAddress: SedAddress | undefined;

  if (address1.ok) {
    firstAddress = address1.value.address;
    index = address1.value.nextIndex;
    index = skipSedHorizontalWhitespace(source, index);
    if (source[index] === ',') {
      index += 1;
      index = skipSedHorizontalWhitespace(source, index);
      const address2 = parseSedAddress(source, index, extendedRegex);
      if (!address2.ok) {
        return { ok: false, error: 'expected second address after comma' };
      }
      secondAddress = address2.value.address;
      index = address2.value.nextIndex;
      index = skipSedHorizontalWhitespace(source, index);
    }
  }

  const commandChar = source[index];
  if (commandChar === undefined) {
    return { ok: false, error: 'unexpected end of script' };
  }

  index += 1;

  if (commandChar === 'p') {
    return {
      ok: true,
      value: {
        command: createSedCommand('print', firstAddress, secondAddress),
        nextIndex: finishSedSimpleCommand(source, index),
      },
    };
  }
  if (commandChar === 'd') {
    return {
      ok: true,
      value: {
        command: createSedCommand('delete', firstAddress, secondAddress),
        nextIndex: finishSedSimpleCommand(source, index),
      },
    };
  }
  if (commandChar === 'q') {
    return {
      ok: true,
      value: {
        command: createSedCommand('quit', firstAddress, secondAddress),
        nextIndex: finishSedSimpleCommand(source, index),
      },
    };
  }
  if (commandChar === 'n') {
    return {
      ok: true,
      value: {
        command: createSedCommand('next', firstAddress, secondAddress),
        nextIndex: finishSedSimpleCommand(source, index),
      },
    };
  }
  if (commandChar === 'a' || commandChar === 'i' || commandChar === 'c') {
    const text = parseSedTextArgument(source, index);
    return {
      ok: true,
      value: {
        command: createSedCommand(
          commandChar === 'a' ? 'append' : commandChar === 'i' ? 'insert' : 'change',
          firstAddress,
          secondAddress,
          {
            text,
          },
        ),
        nextIndex: advancePastSedTextArgument(source, index),
      },
    };
  }
  if (commandChar === 's') {
    const substitute = parseSedSubstitute(source, index, extendedRegex);
    if (!substitute.ok) {
      return substitute;
    }
    return {
      ok: true,
      value: {
        command: createSedCommand('substitute', firstAddress, secondAddress, {
          substitute: substitute.value.substitute,
        }),
        nextIndex: substitute.value.nextIndex,
      },
    };
  }

  return { ok: false, error: `unsupported sed command: ${commandChar}` };
}

function parseSedAddress(
  source: string,
  startIndex: number,
  extendedRegex: boolean,
): { ok: true; value: { address: SedAddress; nextIndex: number } } | { ok: false } {
  if (startIndex >= source.length) {
    return { ok: false };
  }

  if (source[startIndex] === '$') {
    return {
      ok: true,
      value: {
        address: { kind: 'last' },
        nextIndex: startIndex + 1,
      },
    };
  }

  if (isAsciiDigit(source[startIndex]!)) {
    let index = startIndex;
    while (index < source.length && isAsciiDigit(source[index]!)) {
      index += 1;
    }
    return {
      ok: true,
      value: {
        address: { kind: 'line', value: Number.parseInt(source.slice(startIndex, index), 10) },
        nextIndex: index,
      },
    };
  }

  if (source[startIndex] === '/') {
    const regex = parseSedDelimitedContent(source, startIndex + 1, '/');
    if (!regex.ok) {
      return { ok: false };
    }
    const compiled = compileSedRegex(regex.value.content, extendedRegex, false);
    if (!compiled.ok) {
      return { ok: false };
    }
    return {
      ok: true,
      value: {
        address: { kind: 'regex', source: regex.value.content, regex: compiled.value },
        nextIndex: regex.value.nextIndex,
      },
    };
  }

  return { ok: false };
}

function parseSedSubstitute(
  source: string,
  startIndex: number,
  extendedRegex: boolean,
):
  | { ok: true; value: { substitute: SedSubstituteCommand; nextIndex: number } }
  | { ok: false; error: string } {
  const delimiter = source[startIndex];
  if (delimiter === undefined || delimiter === '\n' || delimiter === ';' || delimiter === '\\') {
    return { ok: false, error: 'invalid substitute delimiter' };
  }

  const pattern = parseSedDelimitedContent(source, startIndex + 1, delimiter);
  if (!pattern.ok) {
    return { ok: false, error: 'unterminated substitute pattern' };
  }

  const replacement = parseSedDelimitedContent(source, pattern.value.nextIndex, delimiter);
  if (!replacement.ok) {
    return { ok: false, error: 'unterminated substitute replacement' };
  }

  const flags = parseSedSubstituteFlags(source, replacement.value.nextIndex);
  if (!flags.ok) {
    return flags;
  }

  const compiled = compileSedRegex(pattern.value.content, extendedRegex, flags.value.ignoreCase);
  if (!compiled.ok) {
    return { ok: false, error: compiled.error };
  }

  return {
    ok: true,
    value: {
      substitute: {
        source: pattern.value.content,
        replacement: replacement.value.content,
        global: flags.value.global,
        printOnSuccess: flags.value.printOnSuccess,
        occurrence: flags.value.occurrence,
        ignoreCase: flags.value.ignoreCase,
        regex: compiled.value,
      },
      nextIndex: flags.value.nextIndex,
    },
  };
}

function parseSedDelimitedContent(
  source: string,
  startIndex: number,
  delimiter: string,
): { ok: true; value: { content: string; nextIndex: number } } | { ok: false } {
  let index = startIndex;
  let escaped = false;
  let content = '';

  while (index < source.length) {
    const char = source[index]!;
    if (escaped) {
      content += `\\${char}`;
      escaped = false;
      index += 1;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      index += 1;
      continue;
    }
    if (char === delimiter) {
      return {
        ok: true,
        value: {
          content,
          nextIndex: index + 1,
        },
      };
    }
    content += char;
    index += 1;
  }

  return { ok: false };
}

function parseSedSubstituteFlags(
  source: string,
  startIndex: number,
):
  | {
      ok: true;
      value: {
        global: boolean;
        printOnSuccess: boolean;
        occurrence: number | undefined;
        ignoreCase: boolean;
        nextIndex: number;
      };
    }
  | { ok: false; error: string } {
  let global = false;
  let printOnSuccess = false;
  let occurrence: number | undefined;
  let ignoreCase = false;
  let index = startIndex;
  let digits = '';

  while (index < source.length) {
    const char = source[index]!;
    if (char === ';' || char === '\n') {
      break;
    }
    if (char === ' ' || char === '\t') {
      index += 1;
      continue;
    }
    if (isAsciiDigit(char)) {
      digits += char;
      index += 1;
      continue;
    }
    if (digits.length > 0) {
      occurrence = Number.parseInt(digits, 10);
      digits = '';
    }
    if (char === 'g') {
      global = true;
      index += 1;
      continue;
    }
    if (char === 'p') {
      printOnSuccess = true;
      index += 1;
      continue;
    }
    if (char === 'i' || char === 'I') {
      ignoreCase = true;
      index += 1;
      continue;
    }
    return { ok: false, error: `unsupported substitute flag: ${char}` };
  }

  if (digits.length > 0) {
    occurrence = Number.parseInt(digits, 10);
  }

  return {
    ok: true,
    value: {
      global,
      printOnSuccess,
      occurrence,
      ignoreCase,
      nextIndex: finishSedSimpleCommand(source, index),
    },
  };
}

function parseSedTextArgument(source: string, startIndex: number): string {
  let index = startIndex;
  while (source[index] === ' ' || source[index] === '\t') {
    index += 1;
  }
  if (source[index] === '\\') {
    index += 1;
  }
  return source.slice(index, findSedLineEnd(source, index));
}

function createSedCommand(
  kind: SedCommandKind,
  address1: SedAddress | undefined,
  address2: SedAddress | undefined,
  options: {
    text?: string;
    substitute?: SedSubstituteCommand;
  } = {},
): SedCommand {
  return {
    address1,
    address2,
    kind,
    text: options.text,
    substitute: options.substitute,
  };
}

function advancePastSedTextArgument(source: string, startIndex: number): number {
  const endIndex = findSedLineEnd(source, startIndex);
  if (source[endIndex] === '\n') {
    return endIndex + 1;
  }
  return endIndex;
}

function findSedLineEnd(source: string, startIndex: number): number {
  let index = startIndex;
  while (index < source.length && source[index] !== '\n') {
    index += 1;
  }
  return index;
}

function skipSedSeparators(source: string, index: number): number {
  let nextIndex = index;
  while (nextIndex < source.length) {
    const char = source[nextIndex]!;
    if (char === ';' || char === '\n' || char === ' ' || char === '\t' || char === '\r') {
      nextIndex += 1;
      continue;
    }
    break;
  }
  return nextIndex;
}

function skipSedHorizontalWhitespace(source: string, index: number): number {
  let nextIndex = index;
  while (nextIndex < source.length) {
    const char = source[nextIndex]!;
    if (char === ' ' || char === '\t' || char === '\r') {
      nextIndex += 1;
      continue;
    }
    break;
  }
  return nextIndex;
}

function finishSedSimpleCommand(source: string, index: number): number {
  let nextIndex = index;
  while (nextIndex < source.length) {
    const char = source[nextIndex]!;
    if (char === ' ' || char === '\t' || char === '\r') {
      nextIndex += 1;
      continue;
    }
    if (char === ';') {
      return nextIndex + 1;
    }
    if (char === '\n') {
      return nextIndex + 1;
    }
    break;
  }
  return nextIndex;
}

async function loadSedInputs(
  ctx: CommandContext,
  program: ParsedSedProgram,
  stdin: Uint8Array,
): Promise<SedParseResult<SedInputFile[]>> {
  if (program.inputFiles.length === 0) {
    return {
      ok: true,
      value: [
        {
          path: null,
          displayName: '-',
          lines: byteModelToSedLines(stdin),
          originalBytes: new Uint8Array(stdin),
        },
      ],
    };
  }

  const files: SedInputFile[] = [];
  for (const inputFile of program.inputFiles) {
    const loaded = await loadSedInputFile(ctx, inputFile, stdin);
    if (!loaded.ok) {
      return loaded;
    }
    files.push(loaded.value);
  }

  return { ok: true, value: files };
}

async function loadSedInputFile(
  ctx: CommandContext,
  inputFile: string,
  stdin: Uint8Array,
): Promise<SedParseResult<SedInputFile>> {
  if (inputFile === '-') {
    return {
      ok: true,
      value: {
        path: null,
        displayName: '-',
        lines: byteModelToSedLines(stdin),
        originalBytes: new Uint8Array(stdin),
      },
    };
  }

  let info: VFileInfo;
  const normalized = ctx.vfs.normalize(inputFile);

  try {
    info = await ctx.vfs.stat(inputFile);
  } catch (caught) {
    return {
      ok: false,
      error: await formatSedPathError(ctx, 'sed', inputFile, caught, 'file not found'),
    };
  }

  if (!info.exists) {
    const blockedPath = await firstFileInPath(ctx, normalized);
    if (blockedPath !== null) {
      return { ok: false, error: err(`sed: parent is not a directory: ${blockedPath}`) };
    }
    return {
      ok: false,
      error: err(`sed: file not found: ${normalized}. Use: ls ${parentPath(inputFile)}`),
    };
  }
  if (info.isDir) {
    return {
      ok: false,
      error: err(`sed: path is a directory: ${normalized}. Use: ls ${normalized}`),
    };
  }
  const limitError = materializedLimitError(ctx, 'sed', normalized, info.size);
  if (limitError !== undefined) {
    return { ok: false, error: limitError };
  }

  try {
    const bytes = await ctx.vfs.readBytes(inputFile);
    return {
      ok: true,
      value: {
        path: normalized,
        displayName: normalized,
        lines: byteModelToSedLines(bytes),
        originalBytes: bytes,
      },
    };
  } catch (caught) {
    return {
      ok: false,
      error: await formatSedPathError(ctx, 'sed', inputFile, caught, 'file not found'),
    };
  }
}

function byteModelToSedLines(bytes: Uint8Array): SedInputLine[] {
  const model = createByteLineModel(bytes);
  return model.lines.map(function (line, index): SedInputLine {
    return {
      text: line.text,
      terminated: index < model.lines.length - 1 || model.endsWithNewline,
    };
  });
}

async function applySedInPlace(
  ctx: CommandContext,
  program: ParsedSedProgram,
  inputs: SedInputFile[],
): Promise<CommandResult> {
  const plannedWrites: Array<{
    path: string;
    backupPath: string | null;
    output: Uint8Array;
    original: Uint8Array;
  }> = [];

  for (const input of inputs) {
    if (input.path === null) {
      return err('sed: cannot use -i with stdin');
    }

    const output = executeSedProgram(program, [input], true);
    if (!output.ok) {
      return output.error;
    }

    plannedWrites.push({
      path: input.path,
      backupPath: program.inPlaceSuffix === '' ? null : `${input.path}${program.inPlaceSuffix}`,
      output: output.value,
      original: input.originalBytes,
    });
  }

  for (const write of plannedWrites) {
    if (write.backupPath !== null) {
      try {
        await ctx.vfs.writeBytes(write.backupPath, write.original);
      } catch (caught) {
        return await formatSedPathError(ctx, 'sed', write.backupPath, caught, 'backup path not found');
      }
    }
    try {
      await ctx.vfs.writeBytes(write.path, write.output, false);
    } catch (caught) {
      return await formatSedPathError(ctx, 'sed', write.path, caught, 'file not found');
    }
  }

  return ok('');
}

function executeSedProgram(
  program: ParsedSedProgram,
  inputs: SedInputFile[],
  separateFiles: boolean,
): SedParseResult<Uint8Array> {
  if (separateFiles) {
    const outputChunks: Uint8Array[] = [];
    for (const input of inputs) {
      const execution = executeSedStream(program, toSedStream([input]), true);
      if (!execution.ok) {
        return execution;
      }
      outputChunks.push(execution.value);
    }
    return { ok: true, value: concatSedBytes(outputChunks) };
  }

  return executeSedStream(program, toSedStream(inputs), false);
}

function executeSedStream(
  program: ParsedSedProgram,
  stream: SedStreamLine[],
  separateFiles: boolean,
): SedParseResult<Uint8Array> {
  const outputs: SedOutputRecord[] = [];
  const states = program.commands.map(function (): SedCommandState {
    return { inRange: false };
  });
  let cursor = 0;

  while (cursor < stream.length) {
    let current = toSedCycleLine(stream[cursor]!, cursor, stream.length);
    let nextCursor = cursor + 1;
    const appendQueue: SedOutputRecord[] = [];
    let suppressAutoPrint = false;
    let quit = false;

    for (let commandIndex = 0; commandIndex < program.commands.length; commandIndex += 1) {
      const command = program.commands[commandIndex]!;
      const match = matchesSedCommand(command, states[commandIndex]!, current);
      if (!match.matched) {
        continue;
      }

      switch (command.kind) {
        case 'print':
          emitSedRecord(outputs, { text: current.text, terminated: current.terminated });
          break;
        case 'insert':
          emitSedText(outputs, command.text ?? '');
          break;
        case 'append':
          queueSedText(appendQueue, command.text ?? '');
          break;
        case 'delete':
          suppressAutoPrint = true;
          flushSedAppendQueue(outputs, appendQueue);
          commandIndex = program.commands.length;
          break;
        case 'change':
          suppressAutoPrint = true;
          if (!command.address2 || match.startedRange) {
            emitSedText(outputs, command.text ?? '');
          }
          flushSedAppendQueue(outputs, appendQueue);
          commandIndex = program.commands.length;
          break;
        case 'quit':
          if (!program.quiet) {
            emitSedRecord(outputs, { text: current.text, terminated: current.terminated });
          }
          flushSedAppendQueue(outputs, appendQueue);
          quit = true;
          commandIndex = program.commands.length;
          break;
        case 'next': {
          if (!program.quiet) {
            emitSedRecord(outputs, { text: current.text, terminated: current.terminated });
          }
          flushSedAppendQueue(outputs, appendQueue);
          if (
            nextCursor >= stream.length ||
            crossesSedFileBoundary(stream, current, nextCursor, separateFiles)
          ) {
            suppressAutoPrint = true;
            quit = nextCursor >= stream.length;
            commandIndex = program.commands.length;
            break;
          }
          current = toSedCycleLine(stream[nextCursor]!, nextCursor, stream.length);
          nextCursor += 1;
          break;
        }
        case 'substitute': {
          const substituted = runSedSubstitute(current.text, command.substitute!);
          if (substituted.changed) {
            current = { ...current, text: substituted.text };
            if (command.substitute!.printOnSuccess) {
              emitSedRecord(outputs, { text: current.text, terminated: current.terminated });
            }
          }
          break;
        }
      }
    }

    if (quit) {
      break;
    }

    if (!suppressAutoPrint && !program.quiet) {
      emitSedRecord(outputs, { text: current.text, terminated: current.terminated });
    }
    flushSedAppendQueue(outputs, appendQueue);
    cursor = nextCursor;
  }

  return { ok: true, value: encodeSedOutput(outputs) };
}

function toSedStream(inputs: SedInputFile[]): SedStreamLine[] {
  const stream: SedStreamLine[] = [];

  inputs.forEach(function (input, fileIndex): void {
    input.lines.forEach(function (line, lineIndex): void {
      stream.push({
        ...line,
        fileIndex,
        lineIndex,
      });
    });
  });

  return stream;
}

function toSedCycleLine(line: SedStreamLine, absoluteIndex: number, totalLines: number): SedCycleLine {
  return {
    text: line.text,
    terminated: line.terminated,
    absoluteIndex,
    isLastLine: absoluteIndex === totalLines - 1,
  };
}

function crossesSedFileBoundary(
  stream: SedStreamLine[],
  current: SedCycleLine,
  nextCursor: number,
  separateFiles: boolean,
): boolean {
  if (!separateFiles || nextCursor >= stream.length) {
    return false;
  }

  return stream[current.absoluteIndex]!.fileIndex !== stream[nextCursor]!.fileIndex;
}

function matchesSedCommand(
  command: SedCommand,
  state: SedCommandState,
  current: SedCycleLine,
): SedCommandMatch {
  if (!command.address1) {
    return { matched: true, startedRange: false };
  }

  if (!command.address2) {
    return {
      matched: matchesSedAddress(command.address1, current),
      startedRange: false,
    };
  }

  if (state.inRange) {
    const shouldCloseRange = matchesSedAddress(command.address2, current);
    if (shouldCloseRange) {
      state.inRange = false;
    }
    return { matched: true, startedRange: false };
  }

  if (!matchesSedAddress(command.address1, current)) {
    return { matched: false, startedRange: false };
  }

  const closesImmediately = matchesSedAddress(command.address2, current);
  state.inRange = !closesImmediately;
  return { matched: true, startedRange: true };
}

function matchesSedAddress(address: SedAddress, current: SedCycleLine): boolean {
  if (address.kind === 'line') {
    return current.absoluteIndex + 1 === address.value;
  }
  if (address.kind === 'last') {
    return current.isLastLine;
  }
  return address.regex.test(current.text);
}

function runSedSubstitute(
  text: string,
  substitute: SedSubstituteCommand,
): { text: string; changed: boolean } {
  if (substitute.global && substitute.occurrence !== undefined) {
    return replaceSedMatches(text, substitute, { kind: 'from', occurrence: substitute.occurrence });
  }
  if (substitute.global) {
    return replaceSedMatches(text, substitute, 'all');
  }
  if (substitute.occurrence !== undefined) {
    return replaceSedMatches(text, substitute, substitute.occurrence);
  }
  return replaceSedMatches(text, substitute, 1);
}

function replaceSedMatches(
  text: string,
  substitute: SedSubstituteCommand,
  mode: 'all' | number | { kind: 'from'; occurrence: number },
): { text: string; changed: boolean } {
  const flags = `${substitute.ignoreCase ? 'i' : ''}g`;
  const regex = new RegExp(substitute.regex.source, flags);
  let result = '';
  let lastIndex = 0;
  let changed = false;
  let occurrenceIndex = 0;

  for (const match of text.matchAll(regex)) {
    const matchedText = match[0] ?? '';
    const matchIndex = match.index ?? 0;
    occurrenceIndex += 1;

    const shouldReplace =
      mode === 'all' ||
      occurrenceIndex === mode ||
      (typeof mode === 'object' && occurrenceIndex >= mode.occurrence);
    if (!shouldReplace) {
      continue;
    }

    result += text.slice(lastIndex, matchIndex);
    result += renderSedReplacement(substitute.replacement, match);
    lastIndex = matchIndex + matchedText.length;
    changed = true;

    if (mode !== 'all' && typeof mode !== 'object') {
      result += text.slice(lastIndex);
      return { text: result, changed };
    }

    if (matchedText.length === 0) {
      lastIndex = matchIndex;
    }
  }

  if (!changed) {
    return { text, changed: false };
  }

  result += text.slice(lastIndex);
  return { text: result, changed: true };
}

function renderSedReplacement(replacement: string, match: RegExpMatchArray): string {
  let output = '';

  for (let index = 0; index < replacement.length; index += 1) {
    const char = replacement[index]!;
    if (char === '&') {
      output += match[0] ?? '';
      continue;
    }
    if (char !== '\\') {
      output += char;
      continue;
    }

    const next = replacement[index + 1];
    if (next === undefined) {
      output += '\\';
      continue;
    }

    if (isAsciiDigit(next)) {
      output += match[Number.parseInt(next, 10)] ?? '';
      index += 1;
      continue;
    }

    output += next;
    index += 1;
  }

  return output;
}

function emitSedText(outputs: SedOutputRecord[], text: string): void {
  pushSedText(outputs, text);
}

function queueSedText(queue: SedOutputRecord[], text: string): void {
  pushSedText(queue, text);
}

function pushSedText(target: SedOutputRecord[], text: string): void {
  const lines = text.split('\n');
  for (const line of lines) {
    target.push({ text: line, terminated: true });
  }
}

function flushSedAppendQueue(outputs: SedOutputRecord[], queue: SedOutputRecord[]): void {
  for (const record of queue) {
    outputs.push(record);
  }
  queue.length = 0;
}

function emitSedRecord(outputs: SedOutputRecord[], record: SedOutputRecord): void {
  outputs.push(record);
}

function encodeSedOutput(records: SedOutputRecord[]): Uint8Array {
  if (records.length === 0) {
    return new Uint8Array();
  }

  let text = '';
  records.forEach(function (record, index): void {
    if (index > 0) {
      text += '\n';
    }
    text += record.text;
  });
  if (records[records.length - 1]!.terminated) {
    text += '\n';
  }

  return encodeCLocaleText(text);
}

function concatSedBytes(chunks: Uint8Array[]): Uint8Array {
  const totalLength = chunks.reduce(function (sum, chunk) {
    return sum + chunk.length;
  }, 0);
  const bytes = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }

  return bytes;
}

function compileSedRegex(
  pattern: string,
  extendedRegex: boolean,
  ignoreCase: boolean,
): { ok: true; value: RegExp } | { ok: false; error: string } {
  try {
    const source = extendedRegex ? translateSedExtendedRegex(pattern) : translateSedBasicRegex(pattern);
    return {
      ok: true,
      value: new RegExp(source, ignoreCase ? 'i' : ''),
    };
  } catch (caught) {
    return { ok: false, error: `invalid regex: ${errorMessage(caught)}` };
  }
}

function translateSedExtendedRegex(pattern: string): string {
  return pattern;
}

function translateSedBasicRegex(pattern: string): string {
  let output = '';
  let index = 0;

  while (index < pattern.length) {
    const char = pattern[index]!;

    if (char === '\\') {
      const next = pattern[index + 1];
      if (next === undefined) {
        output += '\\\\';
        break;
      }

      if (
        next === '(' ||
        next === ')' ||
        next === '{' ||
        next === '}' ||
        next === '+' ||
        next === '?' ||
        next === '|'
      ) {
        output += next;
      } else if (isAsciiDigit(next)) {
        output += `\\${next}`;
      } else {
        output += `\\${escapeSedRegexLiteral(next)}`;
      }
      index += 2;
      continue;
    }

    if (char === '[') {
      const characterClass = readSedCharacterClass(pattern, index);
      output += characterClass.value;
      index = characterClass.nextIndex;
      continue;
    }

    if (
      char === '(' ||
      char === ')' ||
      char === '{' ||
      char === '}' ||
      char === '+' ||
      char === '?' ||
      char === '|'
    ) {
      output += `\\${char}`;
      index += 1;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

function readSedCharacterClass(pattern: string, startIndex: number): { value: string; nextIndex: number } {
  let index = startIndex + 1;

  while (index < pattern.length) {
    const char = pattern[index]!;
    if (char === '\\') {
      index += 2;
      continue;
    }
    if (char === ']' && index > startIndex + 1) {
      return {
        value: pattern.slice(startIndex, index + 1),
        nextIndex: index + 1,
      };
    }
    index += 1;
  }

  return {
    value: pattern.slice(startIndex),
    nextIndex: pattern.length,
  };
}

function escapeSedRegexLiteral(char: string): string {
  return /[\\^$.*+?()[\]{}|]/.test(char) ? `\\${char}` : char;
}

function isAsciiDigit(char: string): boolean {
  return char >= '0' && char <= '9';
}

async function formatSedPathError(
  ctx: CommandContext,
  commandName: string,
  filePath: string,
  caught: unknown,
  notFoundLabel: string,
): Promise<CommandResult> {
  const normalized = ctx.vfs.normalize(filePath);
  const code = errorCode(caught);

  if (code === 'ENOENT') {
    const blockedPath = await firstFileInPath(ctx, normalized);
    if (blockedPath !== null) {
      return err(`${commandName}: parent is not a directory: ${blockedPath}`);
    }
    return err(`${commandName}: ${notFoundLabel}: ${normalized}. Use: ls ${parentPath(filePath)}`);
  }
  if (code === 'EISDIR') {
    return err(`${commandName}: path is a directory: ${normalized}. Use: ls ${normalized}`);
  }
  if (code === 'ENOTDIR') {
    return err(`${commandName}: parent is not a directory: ${await blockingParentPath(ctx, normalized)}`);
  }
  if (code === 'EESCAPE') {
    return err(
      formatEscapePathErrorMessage(commandName, caught, normalized) ??
        `${commandName}: path escapes workspace root: ${normalized}`,
    );
  }
  if (code === 'ERESOURCE_LIMIT') {
    return err(
      formatResourceLimitErrorMessage(commandName, caught) ??
        `${commandName}: resource limit exceeded (resource limit) at ${normalized}`,
    );
  }

  return err(`${commandName}: ${errorMessage(caught)}`);
}
