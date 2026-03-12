import { parentOf, posixNormalize } from './vfs/path-utils.js';

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

export function looksBinary(data: Uint8Array): boolean {
  if (data.length === 0) {
    return false;
  }
  for (const byte of data) {
    if (byte === 0) {
      return true;
    }
  }

  let decoded = '';
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
