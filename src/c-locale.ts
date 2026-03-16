import { textEncoder } from './types.js';

const ASCII_LOWERCASE_A = 97;
const ASCII_LOWERCASE_Z = 122;
const ASCII_UPPERCASE_A = 65;
const ASCII_UPPERCASE_Z = 90;
const ASCII_CASE_OFFSET = 32;

export function foldAsciiCaseText(text: string): string {
  let output = '';
  let changed = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const code = text.charCodeAt(index);
    if (code < ASCII_LOWERCASE_A || code > ASCII_LOWERCASE_Z) {
      output += char;
      continue;
    }

    output += String.fromCharCode(code - ASCII_CASE_OFFSET);
    changed = true;
  }

  return changed ? output : text;
}

export function toCLocaleSortBytes(text: string, ignoreCase = false): Uint8Array {
  const bytes = textEncoder.encode(text);
  if (!ignoreCase) {
    return bytes;
  }

  let folded: Uint8Array | undefined;

  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index]!;
    if (value < ASCII_LOWERCASE_A || value > ASCII_LOWERCASE_Z) {
      if (folded !== undefined) {
        folded[index] = value;
      }
      continue;
    }

    if (folded === undefined) {
      folded = bytes.slice();
    }
    folded[index] = value - ASCII_CASE_OFFSET;
  }

  return folded ?? bytes;
}

export function compareCLocaleText(left: string, right: string, ignoreCase = false): number {
  const leftBytes = toCLocaleSortBytes(left, ignoreCase);
  const rightBytes = toCLocaleSortBytes(right, ignoreCase);
  const limit = Math.min(leftBytes.length, rightBytes.length);

  for (let index = 0; index < limit; index += 1) {
    const leftValue = leftBytes[index]!;
    const rightValue = rightBytes[index]!;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return leftBytes.length - rightBytes.length;
}

export function buildCLocaleCaseInsensitiveRegexSource(source: string): string {
  let output = '';
  let index = 0;

  while (index < source.length) {
    const char = source[index]!;

    if (char === '\\') {
      const transformed = transformRegexEscape(source, index, false);
      output += transformed.output;
      index = transformed.nextIndex;
      continue;
    }

    if (char === '[') {
      const transformed = transformRegexCharacterClass(source, index);
      output += transformed.output;
      index = transformed.nextIndex;
      continue;
    }

    output += expandAsciiRegexLiteral(char);
    index += 1;
  }

  return output;
}

export function compileCLocaleRegex(source: string, flags = '', ignoreCase = false): RegExp {
  const resolvedSource = ignoreCase ? buildCLocaleCaseInsensitiveRegexSource(source) : source;
  return new RegExp(resolvedSource, flags);
}

function transformRegexEscape(
  source: string,
  index: number,
  inCharacterClass: boolean,
): { output: string; nextIndex: number } {
  const next = source[index + 1];
  if (next === undefined) {
    return { output: '\\\\', nextIndex: source.length };
  }

  const unicodeEscape = readRegexUnicodeEscape(source, index);
  if (unicodeEscape !== null) {
    return unicodeEscape;
  }

  const hexEscape = readRegexHexEscape(source, index);
  if (hexEscape !== null) {
    return hexEscape;
  }

  const controlEscape = readRegexControlEscape(source, index);
  if (controlEscape !== null) {
    return controlEscape;
  }

  const namedBackreference = readRegexNamedBackreference(source, index);
  if (namedBackreference !== null) {
    return namedBackreference;
  }

  if (
    /[0-9]/.test(next) ||
    'bBdDsSwWfFnNrRtTvV0'.includes(next) ||
    '^$\\.*+?()[]{}|/-'.includes(next)
  ) {
    return { output: `\\${next}`, nextIndex: index + 2 };
  }

  if (isAsciiLetter(next)) {
    return {
      output: inCharacterClass ? expandAsciiCharacterClassLiteral(next) : expandAsciiRegexLiteral(next),
      nextIndex: index + 2,
    };
  }

  return { output: `\\${next}`, nextIndex: index + 2 };
}

function transformRegexCharacterClass(
  source: string,
  index: number,
): { output: string; nextIndex: number } {
  let output = '[';
  let cursor = index + 1;

  if (source[cursor] === '^') {
    output += '^';
    cursor += 1;
  }
  if (source[cursor] === ']') {
    output += ']';
    cursor += 1;
  }

  while (cursor < source.length) {
    const char = source[cursor]!;
    if (char === ']') {
      output += ']';
      return { output, nextIndex: cursor + 1 };
    }

    if (char === '\\') {
      const transformed = transformRegexEscape(source, cursor, true);
      output += transformed.output;
      cursor = transformed.nextIndex;
      continue;
    }

    const rangeEnd = source[cursor + 2];
    if (
      source[cursor + 1] === '-' &&
      rangeEnd !== undefined &&
      rangeEnd !== ']' &&
      isAsciiLetter(char) &&
      isAsciiLetter(rangeEnd)
    ) {
      output += expandAsciiCharacterClassRange(char, rangeEnd);
      cursor += 3;
      continue;
    }

    output += expandAsciiCharacterClassLiteral(char);
    cursor += 1;
  }

  return { output, nextIndex: source.length };
}

function readRegexUnicodeEscape(
  source: string,
  index: number,
): { output: string; nextIndex: number } | null {
  if (source[index + 1] !== 'u') {
    return null;
  }

  if (source[index + 2] === '{') {
    const closeIndex = source.indexOf('}', index + 3);
    if (closeIndex === -1) {
      return null;
    }
    return {
      output: source.slice(index, closeIndex + 1),
      nextIndex: closeIndex + 1,
    };
  }

  const literal = source.slice(index, index + 6);
  return /^[\\]u[0-9A-Fa-f]{4}$/.test(literal)
    ? { output: literal, nextIndex: index + 6 }
    : null;
}

function readRegexHexEscape(
  source: string,
  index: number,
): { output: string; nextIndex: number } | null {
  const literal = source.slice(index, index + 4);
  return /^[\\]x[0-9A-Fa-f]{2}$/.test(literal)
    ? { output: literal, nextIndex: index + 4 }
    : null;
}

function readRegexControlEscape(
  source: string,
  index: number,
): { output: string; nextIndex: number } | null {
  if (source[index + 1] !== 'c' || source[index + 2] === undefined) {
    return null;
  }
  return {
    output: source.slice(index, index + 3),
    nextIndex: index + 3,
  };
}

function readRegexNamedBackreference(
  source: string,
  index: number,
): { output: string; nextIndex: number } | null {
  if (source[index + 1] !== 'k' || source[index + 2] !== '<') {
    return null;
  }

  const closeIndex = source.indexOf('>', index + 3);
  if (closeIndex === -1) {
    return null;
  }

  return {
    output: source.slice(index, closeIndex + 1),
    nextIndex: closeIndex + 1,
  };
}

function expandAsciiRegexLiteral(char: string): string {
  if (!isAsciiLetter(char)) {
    return char;
  }

  const upper = char.toUpperCase();
  const lower = char.toLowerCase();
  return `[${upper}${lower}]`;
}

function expandAsciiCharacterClassLiteral(char: string): string {
  if (!isAsciiLetter(char)) {
    return char;
  }

  const upper = char.toUpperCase();
  const lower = char.toLowerCase();
  return upper === lower ? char : `${upper}${lower}`;
}

function expandAsciiCharacterClassRange(start: string, end: string): string {
  const startLower = start.toLowerCase();
  const endLower = end.toLowerCase();
  const startCode = startLower.charCodeAt(0);
  const endCode = endLower.charCodeAt(0);

  if (
    startCode < ASCII_LOWERCASE_A ||
    startCode > ASCII_LOWERCASE_Z ||
    endCode < ASCII_LOWERCASE_A ||
    endCode > ASCII_LOWERCASE_Z ||
    startCode > endCode
  ) {
    return `${expandAsciiCharacterClassLiteral(start)}-${expandAsciiCharacterClassLiteral(end)}`;
  }

  const upperStart = String.fromCharCode(startCode - ASCII_CASE_OFFSET);
  const upperEnd = String.fromCharCode(endCode - ASCII_CASE_OFFSET);
  const lowerStart = String.fromCharCode(startCode);
  const lowerEnd = String.fromCharCode(endCode);
  return `${upperStart}-${upperEnd}${lowerStart}-${lowerEnd}`;
}

function isAsciiLetter(char: string): boolean {
  if (char.length === 0) {
    return false;
  }
  const code = char.charCodeAt(0);
  return (
    (code >= ASCII_LOWERCASE_A && code <= ASCII_LOWERCASE_Z) ||
    (code >= ASCII_UPPERCASE_A && code <= ASCII_UPPERCASE_Z)
  );
}
