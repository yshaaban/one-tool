import { forwardRef, useEffect, useRef, useCallback, useImperativeHandle } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { AgentCLI } from '@onetool/one-tool/browser';
import { tokenizeCommand, type CommandTokenKind } from '../utils/command-highlighting';

interface TerminalProps {
  runtime: AgentCLI;
  welcomeMessage?: string;
  onCommand?: (cmd: string, output: string) => void;
  onReady?: () => void;
  readOnly?: boolean;
  autoFocus?: boolean;
}

export interface TerminalPlaybackOptions {
  animate?: boolean;
  leadingDelayMs?: number;
  typingDelayMs?: number;
}

export interface TerminalHandle {
  runCommand(command: string, options?: TerminalPlaybackOptions): Promise<string>;
  showCommandOutput(command: string, output: string, options?: TerminalPlaybackOptions): Promise<void>;
}

const PROMPT = '\x1b[38;5;81m$\x1b[0m ';
const MUTED_COLOR = '\x1b[38;5;246m';
const RESET = '\x1b[0m';
const DEFAULT_TYPING_DELAY_MS = 22;
const COMMAND_COLOR = '\x1b[38;5;81m';
const ARGUMENT_COLOR = '\x1b[38;5;229m';
const FLAG_COLOR = '\x1b[38;5;177m';
const PATH_COLOR = '\x1b[38;5;117m';
const STRING_COLOR = '\x1b[38;5;114m';
const OPERATOR_COLOR = '\x1b[38;5;221m';

interface CompletionMatch {
  replacement: string;
  display: string;
}

function formatTerminalError(err: unknown): string {
  return `\x1b[31mError: ${err instanceof Error ? err.message : String(err)}\x1b[0m`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function ringBell(term: XTerm): void {
  term.write('\x07');
}

function isPathToken(token: string): boolean {
  return (
    token === '' ||
    token.startsWith('/') ||
    token.startsWith('./') ||
    token.startsWith('../') ||
    token.includes('/')
  );
}

function getInputTokenColor(kind: CommandTokenKind): string {
  switch (kind) {
    case 'command':
      return COMMAND_COLOR;
    case 'operator':
      return OPERATOR_COLOR;
    case 'flag':
      return FLAG_COLOR;
    case 'path':
      return PATH_COLOR;
    case 'string':
      return STRING_COLOR;
    case 'argument':
      return ARGUMENT_COLOR;
  }
}

function renderHighlightedInput(input: string): string {
  if (input.length === 0) {
    return '';
  }

  return tokenizeCommand(input)
    .map((token) => `${getInputTokenColor(token.kind)}${token.text}${RESET}`)
    .join('');
}

function getCommonPrefix(values: readonly string[]): string {
  if (values.length === 0) {
    return '';
  }

  let prefix = values[0] ?? '';
  for (const value of values.slice(1)) {
    while (!value.startsWith(prefix) && prefix.length > 0) {
      prefix = prefix.slice(0, -1);
    }
    if (prefix.length === 0) {
      return '';
    }
  }

  return prefix;
}

function getTokenStart(input: string): number {
  if (input.length === 0 || /\s$/.test(input)) {
    return input.length;
  }

  let index = input.length - 1;
  while (index >= 0) {
    const char = input[index] ?? '';
    if (/\s/.test(char) || char === '|' || char === '&' || char === ';') {
      break;
    }
    index -= 1;
  }

  return index + 1;
}

function getLastOperatorEnd(input: string): number {
  const operatorMatches = [...input.matchAll(/\|\||&&|[|;]/g)];
  const lastOperator = operatorMatches.at(-1);
  if (!lastOperator || lastOperator.index === undefined) {
    return 0;
  }
  return lastOperator.index + lastOperator[0].length;
}

function isCommandPosition(input: string, tokenStart: number): boolean {
  const segment = input.slice(getLastOperatorEnd(input), tokenStart);
  return segment.trim().length === 0;
}

function buildAutocompleteInput(input: string, tokenStart: number, replacement: string): string {
  return `${input.slice(0, tokenStart)}${replacement}`;
}

async function getCommandMatches(runtime: AgentCLI, partial: string): Promise<CompletionMatch[]> {
  const names = runtime.registry
    .names()
    .filter((name) => name.startsWith(partial))
    .sort();
  return names.map((name) => ({
    replacement: `${name} `,
    display: name,
  }));
}

async function getPathMatches(runtime: AgentCLI, token: string): Promise<CompletionMatch[]> {
  const normalizedToken = token === '' ? '/' : token;
  const lastSlash = normalizedToken.lastIndexOf('/');
  const directory = lastSlash >= 0 ? normalizedToken.slice(0, lastSlash) || '/' : '/';
  const partialName = lastSlash >= 0 ? normalizedToken.slice(lastSlash + 1) : normalizedToken;
  const entryNames = await runtime.ctx.vfs.listdir(directory);
  const matches: CompletionMatch[] = [];

  for (const entryName of entryNames.sort()) {
    if (!entryName.startsWith(partialName)) {
      continue;
    }

    const fullPath = directory === '/' ? `/${entryName}` : `${directory}/${entryName}`;
    const info = await runtime.ctx.vfs.stat(fullPath);
    const replacementPath = info.isDir ? `${fullPath}/` : `${fullPath} `;
    matches.push({
      replacement: replacementPath,
      display: info.isDir ? `${fullPath}/` : fullPath,
    });
  }

  return matches;
}

async function getAutocompleteMatches(runtime: AgentCLI, input: string): Promise<CompletionMatch[]> {
  const tokenStart = getTokenStart(input);
  const currentToken = input.slice(tokenStart);

  if (isCommandPosition(input, tokenStart)) {
    return getCommandMatches(runtime, currentToken);
  }

  if (!isPathToken(currentToken)) {
    return [];
  }

  return getPathMatches(runtime, currentToken);
}

export const TerminalComponent = forwardRef<TerminalHandle, TerminalProps>(function TerminalComponent(
  { runtime, welcomeMessage, onCommand, onReady, readOnly = false, autoFocus = false }: TerminalProps,
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const inputRef = useRef('');
  const draftInputRef = useRef('');
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const busyRef = useRef(false);
  const readOnlyRef = useRef(readOnly);
  const onReadyRef = useRef(onReady);
  const autocompleteStateRef = useRef<{ input: string; showedSuggestions: boolean }>({
    input: '',
    showedSuggestions: false,
  });

  useEffect(() => {
    readOnlyRef.current = readOnly;
  }, [readOnly]);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  const focusTerminal = useCallback(() => {
    const term = termRef.current;
    if (!term) {
      return;
    }

    term.focus();
  }, []);

  const renderInputLine = useCallback((input: string) => {
    const term = termRef.current;
    if (!term) {
      return;
    }

    const line =
      input.length > 0 ? `\r\x1b[2K${PROMPT}${renderHighlightedInput(input)}` : `\r\x1b[2K${PROMPT}`;
    term.write(line);
  }, []);

  const recordCommand = useCallback((command: string) => {
    historyRef.current.push(command);
    historyIndexRef.current = -1;
    draftInputRef.current = '';
  }, []);

  const resetAutocompleteState = useCallback(() => {
    autocompleteStateRef.current = { input: '', showedSuggestions: false };
  }, []);

  const writeOutput = useCallback((output: string) => {
    const term = termRef.current;
    if (!term || output.length === 0) {
      return;
    }

    for (const line of output.split('\n')) {
      term.writeln(line);
    }
  }, []);

  const echoCommandLine = useCallback(
    async (command: string, options?: TerminalPlaybackOptions): Promise<void> => {
      const term = termRef.current;
      if (!term) {
        return;
      }

      if (options?.leadingDelayMs) {
        await sleep(options.leadingDelayMs);
      }

      if (options?.animate) {
        const typingDelayMs = options.typingDelayMs ?? DEFAULT_TYPING_DELAY_MS;
        inputRef.current = '';
        renderInputLine('');

        for (const char of command) {
          inputRef.current += char;
          renderInputLine(inputRef.current);
          await sleep(typingDelayMs);
        }
      } else {
        inputRef.current = command;
        renderInputLine(inputRef.current);
      }

      term.writeln('');
      inputRef.current = '';
    },
    [renderInputLine],
  );

  const showSuggestions = useCallback(
    (matches: readonly CompletionMatch[]) => {
      const term = termRef.current;
      if (!term || matches.length === 0) {
        return;
      }

      term.writeln('');
      term.writeln(`${MUTED_COLOR}${matches.map((match) => match.display).join('   ')}${RESET}`);
      renderInputLine(inputRef.current);
    },
    [renderInputLine],
  );

  const handleAutocomplete = useCallback(async (): Promise<void> => {
    const term = termRef.current;
    if (!term) {
      return;
    }

    const currentInput = inputRef.current;
    const tokenStart = getTokenStart(currentInput);
    const currentToken = currentInput.slice(tokenStart);

    let matches: CompletionMatch[];
    try {
      matches = await getAutocompleteMatches(runtime, currentInput);
    } catch {
      ringBell(term);
      return;
    }

    if (matches.length === 0) {
      ringBell(term);
      return;
    }

    if (matches.length === 1) {
      inputRef.current = buildAutocompleteInput(currentInput, tokenStart, matches[0]?.replacement ?? '');
      renderInputLine(inputRef.current);
      resetAutocompleteState();
      return;
    }

    const commonReplacement = getCommonPrefix(matches.map((match) => match.replacement));
    if (commonReplacement.length > currentToken.length) {
      inputRef.current = buildAutocompleteInput(currentInput, tokenStart, commonReplacement);
      renderInputLine(inputRef.current);
      autocompleteStateRef.current = {
        input: inputRef.current,
        showedSuggestions: false,
      };
      return;
    }

    const previousAutocomplete = autocompleteStateRef.current;
    if (previousAutocomplete.input === currentInput && !previousAutocomplete.showedSuggestions) {
      autocompleteStateRef.current = { input: currentInput, showedSuggestions: true };
      showSuggestions(matches);
      return;
    }

    autocompleteStateRef.current = { input: currentInput, showedSuggestions: false };
    ringBell(term);
  }, [renderInputLine, resetAutocompleteState, runtime, showSuggestions]);

  const runCommandInTerminal = useCallback(
    async (
      command: string,
      options: {
        echoCommand: boolean;
        leadingBlankLine?: boolean;
        output?: string;
        playback?: TerminalPlaybackOptions;
      },
    ): Promise<string> => {
      const term = termRef.current;
      if (!term || busyRef.current) {
        return '';
      }
      if (!command.trim()) {
        if (options.leadingBlankLine) {
          term.writeln('');
        }
        renderInputLine('');
        return '';
      }

      recordCommand(command);
      busyRef.current = true;

      try {
        if (options.echoCommand) {
          await echoCommandLine(command, options.playback);
        } else if (options.leadingBlankLine) {
          term.writeln('');
        }

        const output = options.output ?? (await runtime.run(command));
        writeOutput(output);
        onCommand?.(command, output);
        return output;
      } catch (err) {
        const output = formatTerminalError(err);
        writeOutput(output);
        return output;
      } finally {
        busyRef.current = false;
        renderInputLine('');
      }
    },
    [echoCommandLine, onCommand, recordCommand, renderInputLine, runtime, writeOutput],
  );

  const executeTypedCommand = useCallback(
    async (cmd: string): Promise<string> => {
      return runCommandInTerminal(cmd, { echoCommand: false, leadingBlankLine: true });
    },
    [runCommandInTerminal],
  );

  const showCommandOutput = useCallback(
    async (command: string, output: string, options?: TerminalPlaybackOptions): Promise<void> => {
      await runCommandInTerminal(command, { echoCommand: true, output, playback: options });
    },
    [runCommandInTerminal],
  );

  const runProgrammaticCommand = useCallback(
    async (command: string, options?: TerminalPlaybackOptions): Promise<string> => {
      return runCommandInTerminal(command, { echoCommand: true, playback: options });
    },
    [runCommandInTerminal],
  );

  useImperativeHandle(
    ref,
    () => ({
      runCommand: runProgrammaticCommand,
      showCommandOutput,
    }),
    [runProgrammaticCommand, showCommandOutput],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new XTerm({
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: '#264f78',
        black: '#0d1117',
        red: '#f85149',
        green: '#3fb950',
        yellow: '#d29922',
        blue: '#58a6ff',
        magenta: '#bc8cff',
        cyan: '#39c5cf',
        white: '#e6edf3',
      },
      fontFamily: "'SF Mono', 'Cascadia Code', 'Fira Code', monospace",
      fontSize: 14,
      lineHeight: 1.4,
      cursorBlink: true,
      convertEol: true,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);
    fitAddon.fit();

    termRef.current = term;

    if (welcomeMessage) {
      term.writeln(welcomeMessage);
      term.writeln('');
    }
    renderInputLine('');
    onReadyRef.current?.();

    if (autoFocus) {
      window.requestAnimationFrame(() => {
        focusTerminal();
        window.setTimeout(focusTerminal, 40);
      });
    }

    term.onKey(({ key, domEvent }) => {
      if (busyRef.current || readOnlyRef.current) return;

      if (domEvent.key === 'Enter') {
        const cmd = inputRef.current;
        inputRef.current = '';
        void executeTypedCommand(cmd);
        return;
      }

      if (domEvent.key === 'Backspace') {
        if (inputRef.current.length > 0) {
          inputRef.current = inputRef.current.slice(0, -1);
          resetAutocompleteState();
          renderInputLine(inputRef.current);
        }
        return;
      }

      if (domEvent.key === 'Tab') {
        domEvent.preventDefault();
        void handleAutocomplete();
        return;
      }

      if (domEvent.key === 'ArrowUp') {
        const history = historyRef.current;
        if (history.length === 0) return;
        if (historyIndexRef.current === -1) {
          draftInputRef.current = inputRef.current;
          historyIndexRef.current = history.length - 1;
        } else if (historyIndexRef.current > 0) {
          historyIndexRef.current--;
        }
        const entry = history[historyIndexRef.current];
        inputRef.current = entry;
        resetAutocompleteState();
        renderInputLine(inputRef.current);
        return;
      }

      if (domEvent.key === 'ArrowDown') {
        const history = historyRef.current;
        if (historyIndexRef.current === -1) {
          return;
        }
        if (historyIndexRef.current >= 0 && historyIndexRef.current < history.length - 1) {
          historyIndexRef.current++;
          const entry = history[historyIndexRef.current];
          inputRef.current = entry;
        } else {
          historyIndexRef.current = -1;
          inputRef.current = draftInputRef.current;
        }
        resetAutocompleteState();
        renderInputLine(inputRef.current);
        return;
      }

      // Ignore other control keys
      if (domEvent.ctrlKey || domEvent.altKey || domEvent.metaKey) return;
      if (key.length === 1 && key.charCodeAt(0) >= 32) {
        inputRef.current += key;
        resetAutocompleteState();
        renderInputLine(inputRef.current);
      }
    });

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(container);

    const handlePointerDown = () => {
      term.focus();
    };
    container.addEventListener('pointerdown', handlePointerDown);

    return () => {
      resizeObserver.disconnect();
      container.removeEventListener('pointerdown', handlePointerDown);
      term.dispose();
      termRef.current = null;
    };
  }, [
    autoFocus,
    executeTypedCommand,
    focusTerminal,
    handleAutocomplete,
    renderInputLine,
    resetAutocompleteState,
    welcomeMessage,
  ]);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        minHeight: '400px',
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid var(--border)',
        background: 'linear-gradient(180deg, rgba(17, 24, 39, 0.96), rgba(13, 17, 23, 0.98))',
        boxShadow: '0 20px 40px rgba(0, 0, 0, 0.28)',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0.65rem 0.9rem',
          borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
          background: 'rgba(255, 255, 255, 0.03)',
          fontSize: '0.78rem',
          color: 'var(--text-muted)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div style={{ display: 'flex', gap: '0.35rem' }}>
            <span style={trafficLight('#ff5f57')} />
            <span style={trafficLight('#febc2e')} />
            <span style={trafficLight('#28c840')} />
          </div>
          <span style={{ color: 'var(--text)' }}>one-tool shell</span>
        </div>
        <span>Tab autocomplete · ↑↓ history</span>
      </div>
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: '100%',
          minHeight: '400px',
          padding: '0.35rem 0',
        }}
      />
    </div>
  );
});

export default TerminalComponent;

function trafficLight(color: string): React.CSSProperties {
  return {
    width: '0.72rem',
    height: '0.72rem',
    borderRadius: '999px',
    display: 'inline-block',
    background: color,
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.15)',
  };
}
