export class ParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ParseError';
  }
}

export interface SimpleCommandNode {
  argv: string[];
}

export interface PipelineNode {
  commands: SimpleCommandNode[];
}

export interface ChainNode {
  relationFromPrevious: '&&' | '||' | ';' | null;
  pipeline: PipelineNode;
}

function flushCurrent(tokens: string[], current: { value: string }): void {
  if (current.value.length > 0) {
    tokens.push(current.value);
    current.value = '';
  }
}

export function tokenizeCommandLine(commandLine: string): string[] {
  if (!commandLine.trim()) {
    throw new ParseError('empty command string');
  }

  const tokens: string[] = [];
  const current = { value: '' };
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < commandLine.length; index += 1) {
    const char = commandLine[index]!;
    const next = commandLine[index + 1];

    if (quote !== null) {
      if (char === quote) {
        quote = null;
        continue;
      }
      if (quote === '"' && char === '\\' && next !== undefined) {
        current.value += next;
        index += 1;
        continue;
      }
      current.value += char;
      continue;
    }

    if (/\s/.test(char)) {
      flushCurrent(tokens, current);
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === '\\') {
      if (next === undefined) {
        throw new ParseError('dangling escape at end of command');
      }
      current.value += next;
      index += 1;
      continue;
    }

    if (char === '`' || (char === '$' && next === '(')) {
      throw new ParseError(
        'command substitution is not supported. Compose commands explicitly with pipes and files.',
      );
    }

    if (char === '>' || char === '<') {
      throw new ParseError(
        `redirection operator '${char}' is not supported. Use pipes plus write/append instead.`,
      );
    }

    if (char === '&') {
      flushCurrent(tokens, current);
      if (next === '&') {
        tokens.push('&&');
        index += 1;
        continue;
      }
      throw new ParseError("background operator '&' is not supported. Use ';' or explicit chaining instead.");
    }

    if (char === '|') {
      flushCurrent(tokens, current);
      if (next === '|') {
        tokens.push('||');
        index += 1;
      } else {
        tokens.push('|');
      }
      continue;
    }

    if (char === ';') {
      flushCurrent(tokens, current);
      tokens.push(';');
      continue;
    }

    current.value += char;
  }

  if (quote !== null) {
    throw new ParseError(`unterminated ${quote} quote`);
  }

  flushCurrent(tokens, current);

  if (tokens.length === 0) {
    throw new ParseError('empty command string');
  }

  return tokens;
}

export function parseCommandLine(commandLine: string): ChainNode[] {
  const tokens = tokenizeCommandLine(commandLine);

  const chain: ChainNode[] = [];
  let currentPipeline: SimpleCommandNode[] = [];
  let currentArgv: string[] = [];
  let relationFromPrevious: '&&' | '||' | ';' | null = null;

  const flushCommand = (): void => {
    if (currentArgv.length === 0) {
      throw new ParseError('unexpected operator');
    }
    currentPipeline.push({ argv: currentArgv });
    currentArgv = [];
  };

  const flushPipeline = (nextRelation: '&&' | '||' | ';' | null): void => {
    flushCommand();
    chain.push({
      relationFromPrevious,
      pipeline: { commands: currentPipeline },
    });
    currentPipeline = [];
    relationFromPrevious = nextRelation;
  };

  for (const token of tokens) {
    if (token === '|') {
      flushCommand();
      continue;
    }
    if (token === '&&' || token === '||' || token === ';') {
      flushPipeline(token);
      continue;
    }
    currentArgv.push(token);
  }

  if (currentArgv.length === 0) {
    throw new ParseError('unexpected end of command');
  }

  currentPipeline.push({ argv: currentArgv });
  chain.push({
    relationFromPrevious,
    pipeline: { commands: currentPipeline },
  });

  return chain;
}
