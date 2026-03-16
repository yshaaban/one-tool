import { textEncoder } from './types.js';
import { parentOf, posixNormalize } from './vfs/path-utils.js';

const ASCII_DIGIT_0 = 48;
const ASCII_DIGIT_9 = 57;
const ASCII_LOWERCASE_A = 97;
const ASCII_LOWERCASE_Z = 122;
const ASCII_UPPERCASE_A = 65;
const ASCII_UPPERCASE_Z = 90;
const ASCII_CASE_OFFSET = 32;

export function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

export function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  const seconds = durationMs / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds - minutes * 60;
  return `${minutes}m${remainder.toFixed(1)}s`;
}

export function formatSize(size: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = size;
  for (const unit of units) {
    if (value < 1024 || unit === units[units.length - 1]) {
      return unit === 'B' ? `${Math.round(value)}${unit}` : `${value.toFixed(1)}${unit}`;
    }
    value /= 1024;
  }
  return `${size}B`;
}

export function tokenizeForSearch(text: string): Set<string> {
  const matches = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  return new Set(matches);
}

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

export function looksBinary(data: Uint8Array): boolean {
  if (data.length === 0) {
    return false;
  }
  for (const byte of data) {
    if (byte === 0) {
      return true;
    }
  }

  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return true;
  }

  let controls = 0;
  for (const char of decoded) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 && char !== '\n' && char !== '\r' && char !== '\t') {
      controls += 1;
    }
  }

  return controls / Math.max(decoded.length, 1) > 0.1;
}

export function parentPath(inputPath: string): string {
  return parentOf(posixNormalize(inputPath));
}

type ArithmeticToken =
  | { kind: 'number'; value: number }
  | { kind: 'operator'; value: '+' | '-' | '*' | '/' | '//' | '%' | '**' }
  | { kind: 'paren'; value: '(' | ')' };

function tokenizeArithmetic(expression: string): ArithmeticToken[] {
  const tokens: ArithmeticToken[] = [];

  for (let index = 0; index < expression.length; ) {
    const char = expression[index]!;

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (/[0-9.]/.test(char)) {
      let end = index + 1;
      while (end < expression.length && /[0-9.]/.test(expression[end] ?? '')) {
        end += 1;
      }
      const literal = expression.slice(index, end);
      if (!/^(?:\d+\.?\d*|\.\d+)$/.test(literal)) {
        throw new Error(`invalid number: ${literal}`);
      }
      tokens.push({ kind: 'number', value: Number(literal) });
      index = end;
      continue;
    }

    if (char === '(' || char === ')') {
      tokens.push({ kind: 'paren', value: char });
      index += 1;
      continue;
    }

    if (char === '*' && expression[index + 1] === '*') {
      tokens.push({ kind: 'operator', value: '**' });
      index += 2;
      continue;
    }

    if (char === '/' && expression[index + 1] === '/') {
      tokens.push({ kind: 'operator', value: '//' });
      index += 2;
      continue;
    }

    if (char === '+' || char === '-' || char === '*' || char === '/' || char === '%') {
      tokens.push({ kind: 'operator', value: char });
      index += 1;
      continue;
    }

    throw new Error(`unsupported character: ${char}`);
  }

  return tokens;
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

function transformRegexCharacterClass(source: string, index: number): { output: string; nextIndex: number } {
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
    if (source[cursor + 1] === '-' && rangeEnd !== undefined && rangeEnd !== ']' && isAsciiLetter(char) && isAsciiLetter(rangeEnd)) {
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

class ArithmeticParser {
  private readonly tokens: ArithmeticToken[];
  private index = 0;

  constructor(tokens: ArithmeticToken[]) {
    this.tokens = tokens;
  }

  parse(): number {
    const value = this.parseAddSub();
    if (this.peek() !== undefined) {
      throw new Error('unexpected trailing input');
    }
    if (!Number.isFinite(value)) {
      throw new Error('result is not finite');
    }
    return value;
  }

  private peek(): ArithmeticToken | undefined {
    return this.tokens[this.index];
  }

  private consume(): ArithmeticToken {
    const token = this.tokens[this.index];
    if (token === undefined) {
      throw new Error('unexpected end of expression');
    }
    this.index += 1;
    return token;
  }

  private matchOperator(...operators: Array<ArithmeticToken['value']>): ArithmeticToken['value'] | null {
    const token = this.peek();
    if (token?.kind === 'operator' && operators.includes(token.value)) {
      this.index += 1;
      return token.value;
    }
    return null;
  }

  private matchParen(value: '(' | ')'): boolean {
    const token = this.peek();
    if (token?.kind === 'paren' && token.value === value) {
      this.index += 1;
      return true;
    }
    return false;
  }

  private parseAddSub(): number {
    let value = this.parseMulDiv();
    for (;;) {
      const operator = this.matchOperator('+', '-');
      if (operator === null) {
        return value;
      }
      const right = this.parseMulDiv();
      value = operator === '+' ? value + right : value - right;
    }
  }

  private parseMulDiv(): number {
    let value = this.parseUnary();
    for (;;) {
      const operator = this.matchOperator('*', '/', '//', '%');
      if (operator === null) {
        return value;
      }
      const right = this.parseUnary();
      if (operator === '*') {
        value *= right;
      } else if (operator === '/') {
        value /= right;
      } else if (operator === '//') {
        value = Math.floor(value / right);
      } else {
        value %= right;
      }
      if (!Number.isFinite(value)) {
        throw new Error('result is not finite');
      }
    }
  }

  private parseUnary(): number {
    const operator = this.matchOperator('+', '-');
    if (operator === '+') {
      return +this.parseUnary();
    }
    if (operator === '-') {
      return -this.parseUnary();
    }
    return this.parsePower();
  }

  private parsePower(): number {
    let value = this.parsePrimary();
    const operator = this.matchOperator('**');
    if (operator === '**') {
      const right = this.parseUnary();
      value = value ** right;
      if (!Number.isFinite(value)) {
        throw new Error('result is not finite');
      }
    }
    return value;
  }

  private parsePrimary(): number {
    if (this.matchParen('(')) {
      const value = this.parseAddSub();
      if (!this.matchParen(')')) {
        throw new Error("missing closing ')'");
      }
      return value;
    }

    const token = this.consume();
    if (token.kind !== 'number') {
      throw new Error('expected number or parenthesized expression');
    }
    return token.value;
  }
}

export function safeEvalArithmetic(expression: string): number {
  const tokens = tokenizeArithmetic(expression);
  if (tokens.length === 0) {
    throw new Error('empty expression');
  }
  return new ArithmeticParser(tokens).parse();
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
