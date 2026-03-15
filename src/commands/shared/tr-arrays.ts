interface ParsedByteElement {
  kind: 'bytes';
  bytes: number[];
  className?: TrCharacterClassName;
}

interface ParsedRepeatElement {
  kind: 'repeat';
  byte: number;
  count?: number;
}

type ParsedTrElement = ParsedByteElement | ParsedRepeatElement;

type ParsedElementResult =
  | { ok: true; element: ParsedTrElement; nextIndex: number; rangeEligible: boolean }
  | { ok: false; error: string };

type TrParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

type TrCharacterClassName =
  | 'alnum'
  | 'alpha'
  | 'blank'
  | 'cntrl'
  | 'digit'
  | 'graph'
  | 'lower'
  | 'print'
  | 'punct'
  | 'space'
  | 'upper'
  | 'xdigit';

export interface TrProgram {
  run(input: Uint8Array): Uint8Array;
}

interface ParsedTrArguments {
  complement: boolean;
  delete: boolean;
  squeeze: boolean;
  truncateSet1: boolean;
  string1: string;
  string2?: string;
}

const CHARACTER_CLASS_NAMES = new Set<TrCharacterClassName>([
  'alnum',
  'alpha',
  'blank',
  'cntrl',
  'digit',
  'graph',
  'lower',
  'print',
  'punct',
  'space',
  'upper',
  'xdigit',
]);

const LOWER_BYTES = rangeBytes(0x61, 0x7a);
const UPPER_BYTES = rangeBytes(0x41, 0x5a);
const DIGIT_BYTES = rangeBytes(0x30, 0x39);

export function compileTrProgram(args: string[]): TrParseResult<TrProgram> {
  const parsedArgs = parseTrArguments(args);
  if (!parsedArgs.ok) {
    return parsedArgs;
  }

  const set1Elements = parseTrElements(parsedArgs.value.string1, 'string1');
  if (!set1Elements.ok) {
    return set1Elements;
  }

  const hasTranslation = !parsedArgs.value.delete && parsedArgs.value.string2 !== undefined;
  const deleteEnabled = parsedArgs.value.delete;
  const squeezeEnabled = parsedArgs.value.squeeze;

  if (!hasTranslation && !deleteEnabled && !squeezeEnabled) {
    return { ok: false, error: 'missing operand. Usage: tr [OPTION]... STRING1 [STRING2]' };
  }

  if (deleteEnabled && !squeezeEnabled && parsedArgs.value.string2 !== undefined) {
    return {
      ok: false,
      error:
        'extra operand. Only one string may be given when deleting without squeezing repeats. Usage: tr [OPTION]... STRING1 [STRING2]',
    };
  }

  const set1 = expandTrElements(set1Elements.value, {
    targetLength: undefined,
    string2: false,
  });

  if (!set1.ok) {
    return set1;
  }

  let set1Bytes = parsedArgs.value.complement ? complementBytes(set1.value) : set1.value;
  const deleteSet = createMembershipSet(set1Bytes);

  let squeezeBytes: number[] = [];
  let translationMap: Uint8Array | undefined;

  if (hasTranslation) {
    const string2 = parsedArgs.value.string2 ?? '';
    const set2Elements = parseTrElements(string2, 'string2');
    if (!set2Elements.ok) {
      return set2Elements;
    }

    const validationError = validateString2Classes(set1Elements.value, set2Elements.value);
    if (validationError !== undefined) {
      return { ok: false, error: validationError };
    }

    const set2 = expandTrElements(set2Elements.value, {
      targetLength: set1Bytes.length,
      string2: true,
    });
    if (!set2.ok) {
      return set2;
    }

    let set2Bytes = set2.value;
    if (!parsedArgs.value.truncateSet1 && set2Bytes.length === 0 && set1Bytes.length > 0) {
      return {
        ok: false,
        error: 'when not truncating set1, string2 must be non-empty',
      };
    }

    if (parsedArgs.value.truncateSet1 && set2Bytes.length < set1Bytes.length) {
      set1Bytes = set1Bytes.slice(0, set2Bytes.length);
    } else if (set2Bytes.length < set1Bytes.length) {
      const fillByte = set2Bytes[set2Bytes.length - 1]!;
      set2Bytes = [
        ...set2Bytes,
        ...Array.from({ length: set1Bytes.length - set2Bytes.length }, function () {
          return fillByte;
        }),
      ];
    }

    translationMap = buildTranslationMap(set1Bytes, set2Bytes);
    if (squeezeEnabled) {
      squeezeBytes = set2Bytes;
    }
  } else if (squeezeEnabled) {
    const squeezeSpec = parsedArgs.value.string2 ?? parsedArgs.value.string1;
    const squeezeElements = parseTrElements(squeezeSpec, 'string2');
    if (!squeezeElements.ok) {
      return squeezeElements;
    }
    const squeezeExpanded = expandTrElements(squeezeElements.value, {
      targetLength: undefined,
      string2: true,
    });
    if (!squeezeExpanded.ok) {
      return squeezeExpanded;
    }
    squeezeBytes = squeezeExpanded.value;
  }

  const squeezeSet = createMembershipSet(squeezeBytes);
  return {
    ok: true,
    value: {
      run(input: Uint8Array): Uint8Array {
        return runTrTransform(input, {
          deleteEnabled,
          deleteSet,
          squeezeSet,
          translate: translationMap,
        });
      },
    },
  };
}

function parseTrArguments(args: string[]): TrParseResult<ParsedTrArguments> {
  let complement = false;
  let deleteFlag = false;
  let squeeze = false;
  let truncateSet1 = false;
  let parsingOptions = true;
  const operands: string[] = [];

  for (const arg of args) {
    if (parsingOptions && arg === '--') {
      parsingOptions = false;
      continue;
    }

    if (parsingOptions && arg.startsWith('-') && arg.length > 1) {
      for (const flag of arg.slice(1)) {
        switch (flag) {
          case 'c':
          case 'C':
            complement = true;
            break;
          case 'd':
            deleteFlag = true;
            break;
          case 's':
            squeeze = true;
            break;
          case 't':
            truncateSet1 = true;
            break;
          default:
            return {
              ok: false,
              error: `unknown option: -${flag}. Usage: tr [OPTION]... STRING1 [STRING2]`,
            };
        }
      }
      continue;
    }

    operands.push(arg);
    parsingOptions = false;
  }

  if (operands.length === 0) {
    return {
      ok: false,
      error: 'missing operand. Usage: tr [OPTION]... STRING1 [STRING2]',
    };
  }
  if (operands.length > 2) {
    return {
      ok: false,
      error: `too many operands. Usage: tr [OPTION]... STRING1 [STRING2]`,
    };
  }

  return {
    ok: true,
    value: buildParsedTrArguments({
      complement,
      deleteFlag,
      squeeze,
      truncateSet1,
      string1: operands[0]!,
      string2: operands[1],
    }),
  };
}

function parseTrElements(value: string, mode: 'string1' | 'string2'): TrParseResult<ParsedTrElement[]> {
  const elements: ParsedTrElement[] = [];
  let index = 0;

  while (index < value.length) {
    const current = parseTrElement(value, index, mode);
    if (!current.ok) {
      return current;
    }

    if (
      current.element.kind === 'bytes' &&
      current.rangeEligible &&
      current.element.bytes.length === 1 &&
      value[current.nextIndex] === '-' &&
      current.nextIndex + 1 < value.length
    ) {
      const next = parseTrElement(value, current.nextIndex + 1, mode);
      if (!next.ok) {
        return next;
      }
      if (next.element.kind !== 'bytes' || next.element.bytes.length !== 1) {
        return { ok: false, error: 'invalid range expression' };
      }
      if (current.element.bytes[0]! > next.element.bytes[0]!) {
        return { ok: false, error: 'invalid descending range' };
      }

      elements.push({
        kind: 'bytes',
        bytes: expandRange(current.element.bytes[0]!, next.element.bytes[0]!),
      });
      index = next.nextIndex;
      continue;
    }

    elements.push(current.element);
    index = current.nextIndex;
  }

  return { ok: true, value: elements };
}

function parseTrElement(value: string, index: number, mode: 'string1' | 'string2'): ParsedElementResult {
  if (mode === 'string2' && value[index] === '[') {
    const repeated = parseRepeatElement(value, index);
    if (repeated.ok) {
      return repeated;
    }
  }

  const special = parseSpecialElement(value, index, mode);
  if (special !== null) {
    return special;
  }

  const escaped = parseEscapedByte(value, index);
  if (escaped !== null) {
    if (!escaped.ok) {
      return escaped;
    }

    return {
      ok: true,
      element: { kind: 'bytes', bytes: [escaped.value.byte] },
      nextIndex: escaped.value.nextIndex,
      rangeEligible: false,
    };
  }

  const byte = byteFromChar(value[index]!);
  if (byte === null) {
    return { ok: false, error: `unsupported non-byte character: ${value[index]}` };
  }

  return {
    ok: true,
    element: { kind: 'bytes', bytes: [byte] },
    nextIndex: index + 1,
    rangeEligible: value[index] !== '-',
  };
}

function parseRepeatElement(value: string, index: number): ParsedElementResult {
  if (value[index] !== '[') {
    return { ok: false, error: 'not a repeat element' };
  }

  const inner = parseRepeatByte(value, index + 1);
  if (!inner.ok) {
    return { ok: false, error: inner.error };
  }
  if (value[inner.value.nextIndex] !== '*') {
    return { ok: false, error: 'not a repeat element' };
  }

  let cursor = inner.value.nextIndex + 1;
  let countText = '';
  while (cursor < value.length && /[0-9]/.test(value[cursor] ?? '')) {
    countText += value[cursor];
    cursor += 1;
  }

  if (value[cursor] !== ']') {
    return { ok: false, error: 'not a repeat element' };
  }

  return {
    ok: true,
    element: createRepeatElement(inner.value.byte, countText),
    nextIndex: cursor + 1,
    rangeEligible: false,
  };
}

function parseSpecialElement(
  value: string,
  index: number,
  mode: 'string1' | 'string2',
): ParsedElementResult | null {
  if (value[index] !== '[' || index + 3 >= value.length) {
    return null;
  }

  const marker = value[index + 1];
  if (marker === ':') {
    const endIndex = value.indexOf(':]', index + 2);
    if (endIndex === -1) {
      return { ok: false, error: 'unterminated character class' };
    }

    const className = value.slice(index + 2, endIndex);
    if (!isTrCharacterClassName(className)) {
      return { ok: false, error: `unknown character class: ${className}` };
    }
    if (mode === 'string2' && className !== 'lower' && className !== 'upper') {
      return {
        ok: false,
        error: `character class [:${className}:] is only valid in STRING2 for paired case conversion`,
      };
    }

    return {
      ok: true,
      element: {
        kind: 'bytes',
        bytes: classBytes(className),
        className,
      },
      nextIndex: endIndex + 2,
      rangeEligible: false,
    };
  }

  if (marker === '=') {
    const endIndex = value.indexOf('=]', index + 2);
    if (endIndex === -1) {
      return { ok: false, error: 'unterminated equivalence class' };
    }

    const content = value.slice(index + 2, endIndex);
    const byte = parseBracketByte(content);
    if (byte === null) {
      return { ok: false, error: `invalid equivalence class: ${content}` };
    }

    return {
      ok: true,
      element: { kind: 'bytes', bytes: [byte] },
      nextIndex: endIndex + 2,
      rangeEligible: false,
    };
  }

  if (marker === '.') {
    const endIndex = value.indexOf('.]', index + 2);
    if (endIndex === -1) {
      return { ok: false, error: 'unterminated collating symbol' };
    }

    const content = value.slice(index + 2, endIndex);
    const byte = parseBracketByte(content);
    if (byte === null) {
      return { ok: false, error: `invalid collating symbol: ${content}` };
    }

    return {
      ok: true,
      element: { kind: 'bytes', bytes: [byte] },
      nextIndex: endIndex + 2,
      rangeEligible: true,
    };
  }

  return null;
}

function parseEscapedByte(
  value: string,
  index: number,
): { ok: true; value: { byte: number; nextIndex: number } } | { ok: false; error: string } | null {
  if (value[index] !== '\\') {
    return null;
  }
  if (index + 1 >= value.length) {
    return { ok: false, error: 'dangling escape in character array' };
  }

  const next = value[index + 1]!;
  const escaped = escapedByteValue(next);
  if (escaped !== null) {
    return {
      ok: true,
      value: {
        byte: escaped,
        nextIndex: index + 2,
      },
    };
  }

  if (/[0-7]/.test(next)) {
    let digits = next;
    let cursor = index + 2;
    while (cursor < value.length && digits.length < 3 && /[0-7]/.test(value[cursor] ?? '')) {
      digits += value[cursor];
      cursor += 1;
    }
    return {
      ok: true,
      value: {
        byte: Number.parseInt(digits, 8) & 0xff,
        nextIndex: cursor,
      },
    };
  }

  const byte = byteFromChar(next);
  if (byte === null) {
    return { ok: false, error: `unsupported non-byte escape target: ${next}` };
  }

  return {
    ok: true,
    value: {
      byte,
      nextIndex: index + 2,
    },
  };
}

function parseRepeatByte(
  value: string,
  index: number,
): { ok: true; value: { byte: number; nextIndex: number } } | { ok: false; error: string } {
  const escaped = parseEscapedByte(value, index);
  if (escaped !== null) {
    return escaped;
  }

  const current = value[index];
  if (current === undefined || current === ']' || current === '*') {
    return { ok: false, error: 'invalid repeated character syntax' };
  }

  const byte = byteFromChar(current);
  if (byte === null) {
    return { ok: false, error: `unsupported non-byte repeated character: ${current}` };
  }

  return {
    ok: true,
    value: {
      byte,
      nextIndex: index + 1,
    },
  };
}

function expandTrElements(
  elements: ParsedTrElement[],
  options: { targetLength: number | undefined; string2: boolean },
): TrParseResult<number[]> {
  const bytes: number[] = [];
  const fixedLength = elements.reduce(function (sum, element) {
    if (element.kind === 'bytes') {
      return sum + element.bytes.length;
    }
    return sum + (element.count ?? 0);
  }, 0);

  const unboundedRepeats = elements.filter(function (element) {
    return element.kind === 'repeat' && element.count === undefined;
  });

  if (unboundedRepeats.length > 1) {
    return { ok: false, error: 'only one [C*] repeat expression is supported in STRING2' };
  }
  if (!options.string2 && unboundedRepeats.length > 0) {
    return { ok: false, error: 'repeat expressions are only valid in STRING2' };
  }

  const targetLength = options.targetLength;
  let remainingFill = targetLength === undefined ? 0 : Math.max(targetLength - fixedLength, 0);

  for (const element of elements) {
    if (element.kind === 'bytes') {
      bytes.push(...element.bytes);
      continue;
    }

    const repeatCount = element.count ?? remainingFill;
    for (let index = 0; index < repeatCount; index += 1) {
      bytes.push(element.byte);
    }
    if (element.count === undefined) {
      remainingFill = 0;
    }
  }

  return { ok: true, value: bytes };
}

function validateString2Classes(set1: ParsedTrElement[], set2: ParsedTrElement[]): string | undefined {
  for (let index = 0; index < set2.length; index += 1) {
    const right = set2[index];
    if (right?.kind !== 'bytes' || (right.className !== 'lower' && right.className !== 'upper')) {
      continue;
    }

    const left = set1[index];
    const expected = right.className === 'lower' ? 'upper' : 'lower';
    if (left?.kind !== 'bytes' || left.className !== expected) {
      return `misaligned [:${right.className}:] and/or [:${expected}:] construct`;
    }
  }

  return undefined;
}

function complementBytes(bytes: number[]): number[] {
  const membership = createMembershipSet(bytes);
  const complement: number[] = [];

  for (let value = 0; value < 256; value += 1) {
    if (!membership[value]) {
      complement.push(value);
    }
  }

  return complement;
}

function buildTranslationMap(set1: number[], set2: number[]): Uint8Array {
  const translation = new Uint8Array(256);
  for (let value = 0; value < 256; value += 1) {
    translation[value] = value;
  }

  for (let index = 0; index < set1.length; index += 1) {
    translation[set1[index]!] = set2[index]!;
  }

  return translation;
}

function createMembershipSet(bytes: number[]): Uint8Array {
  const membership = new Uint8Array(256);

  for (const value of bytes) {
    membership[value] = 1;
  }

  return membership;
}

function runTrTransform(
  input: Uint8Array,
  plan: {
    deleteEnabled: boolean;
    deleteSet: Uint8Array;
    squeezeSet: Uint8Array;
    translate: Uint8Array | undefined;
  },
): Uint8Array {
  const output: number[] = [];
  let previousByte: number | undefined;

  for (const rawByte of input) {
    let currentByte = rawByte;

    if (plan.translate !== undefined) {
      currentByte = plan.translate[currentByte]!;
    } else if (plan.deleteEnabled && plan.deleteSet[currentByte]) {
      continue;
    }

    if (plan.squeezeSet[currentByte] && previousByte === currentByte) {
      continue;
    }

    output.push(currentByte);
    previousByte = currentByte;
  }

  return Uint8Array.from(output);
}

function expandRange(start: number, end: number): number[] {
  const bytes: number[] = [];
  for (let value = start; value <= end; value += 1) {
    bytes.push(value);
  }
  return bytes;
}

function parseRepeatCount(text: string): number {
  return Number.parseInt(text, text.startsWith('0') ? 8 : 10);
}

function buildParsedTrArguments(input: {
  complement: boolean;
  deleteFlag: boolean;
  squeeze: boolean;
  truncateSet1: boolean;
  string1: string;
  string2: string | undefined;
}): ParsedTrArguments {
  if (input.string2 === undefined) {
    return {
      complement: input.complement,
      delete: input.deleteFlag,
      squeeze: input.squeeze,
      truncateSet1: input.truncateSet1,
      string1: input.string1,
    };
  }

  return {
    complement: input.complement,
    delete: input.deleteFlag,
    squeeze: input.squeeze,
    truncateSet1: input.truncateSet1,
    string1: input.string1,
    string2: input.string2,
  };
}

function createRepeatElement(byte: number, countText: string): ParsedRepeatElement {
  if (countText.length === 0) {
    return {
      kind: 'repeat',
      byte,
    };
  }

  return {
    kind: 'repeat',
    byte,
    count: parseRepeatCount(countText),
  };
}

function parseBracketByte(content: string): number | null {
  const escaped = parseEscapedByte(content, 0);
  if (escaped !== null) {
    return escaped.ok && escaped.value.nextIndex === content.length ? escaped.value.byte : null;
  }

  return content.length === 1 ? byteFromChar(content) : null;
}

function classBytes(className: TrCharacterClassName): number[] {
  switch (className) {
    case 'alnum':
      return [...DIGIT_BYTES, ...UPPER_BYTES, ...LOWER_BYTES];
    case 'alpha':
      return [...UPPER_BYTES, ...LOWER_BYTES];
    case 'blank':
      return [9, 32];
    case 'cntrl':
      return [...rangeBytes(0, 31), 127];
    case 'digit':
      return [...DIGIT_BYTES];
    case 'graph':
      return rangeBytes(33, 126);
    case 'lower':
      return [...LOWER_BYTES];
    case 'print':
      return rangeBytes(32, 126);
    case 'punct':
      return rangeBytes(33, 126).filter(function (value) {
        return !DIGIT_BYTES.includes(value) && !UPPER_BYTES.includes(value) && !LOWER_BYTES.includes(value);
      });
    case 'space':
      return [9, 10, 11, 12, 13, 32];
    case 'upper':
      return [...UPPER_BYTES];
    case 'xdigit':
      return [...DIGIT_BYTES, ...rangeBytes(65, 70), ...rangeBytes(97, 102)];
    default: {
      const _exhaustive: never = className;
      return _exhaustive;
    }
  }
}

function isTrCharacterClassName(value: string): value is TrCharacterClassName {
  return CHARACTER_CLASS_NAMES.has(value as TrCharacterClassName);
}

function escapedByteValue(value: string): number | null {
  switch (value) {
    case 'a':
      return 7;
    case 'b':
      return 8;
    case 'f':
      return 12;
    case 'n':
      return 10;
    case 'r':
      return 13;
    case 't':
      return 9;
    case 'v':
      return 11;
    case '\\':
      return 92;
    default:
      return null;
  }
}

function byteFromChar(value: string): number | null {
  const code = value.codePointAt(0);
  if (code === undefined || code > 255) {
    return null;
  }
  return code;
}

function rangeBytes(start: number, end: number): number[] {
  const values: number[] = [];

  for (let current = start; current <= end; current += 1) {
    values.push(current);
  }

  return values;
}
