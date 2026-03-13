export type CommandTokenKind = 'command' | 'operator' | 'flag' | 'path' | 'string' | 'argument';

export interface CommandToken {
  kind: CommandTokenKind;
  text: string;
}

export function tokenizeCommand(input: string): CommandToken[] {
  const tokens: CommandToken[] = [];
  let index = 0;
  let expectingCommand = true;

  while (index < input.length) {
    const char = input[index];

    if (/\s/.test(char ?? '')) {
      const start = index;
      while (index < input.length && /\s/.test(input[index] ?? '')) {
        index += 1;
      }
      tokens.push({ kind: 'argument', text: input.slice(start, index) });
      continue;
    }

    const operator = readOperator(input, index);
    if (operator) {
      tokens.push({ kind: 'operator', text: operator });
      index += operator.length;
      expectingCommand = true;
      continue;
    }

    if (char === '"' || char === "'") {
      const quoted = readQuotedToken(input, index);
      tokens.push({ kind: 'string', text: quoted.text });
      index = quoted.nextIndex;
      expectingCommand = false;
      continue;
    }

    const start = index;
    while (index < input.length) {
      const nextChar = input[index];
      if (/\s/.test(nextChar ?? '') || readOperator(input, index)) {
        break;
      }
      index += 1;
    }

    const text = input.slice(start, index);
    tokens.push({
      kind: classifyToken(text, expectingCommand),
      text,
    });
    expectingCommand = false;
  }

  return tokens;
}

function readOperator(input: string, index: number): string | null {
  const nextTwo = input.slice(index, index + 2);
  if (nextTwo === '&&' || nextTwo === '||') {
    return nextTwo;
  }

  const nextOne = input[index];
  if (nextOne === '|' || nextOne === ';') {
    return nextOne;
  }

  return null;
}

function readQuotedToken(input: string, startIndex: number): { text: string; nextIndex: number } {
  const quote = input[startIndex];
  let index = startIndex + 1;

  while (index < input.length) {
    if (input[index] === '\\') {
      index += 2;
      continue;
    }
    if (input[index] === quote) {
      index += 1;
      break;
    }
    index += 1;
  }

  return {
    text: input.slice(startIndex, index),
    nextIndex: index,
  };
}

function classifyToken(text: string, expectingCommand: boolean): CommandTokenKind {
  if (expectingCommand) {
    return 'command';
  }
  if (text.startsWith('-')) {
    return 'flag';
  }
  if (looksLikePath(text)) {
    return 'path';
  }
  return 'argument';
}

function looksLikePath(text: string): boolean {
  return text.startsWith('/') || text.startsWith('./') || text.startsWith('../') || text.includes('/');
}
