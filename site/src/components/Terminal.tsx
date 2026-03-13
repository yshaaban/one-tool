import { forwardRef, useEffect, useRef, useCallback, useImperativeHandle } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { AgentCLI } from 'one-tool/browser';

interface TerminalProps {
  runtime: AgentCLI;
  welcomeMessage?: string;
  onCommand?: (cmd: string, output: string) => void;
}

export interface TerminalHandle {
  runCommand(command: string): Promise<string>;
  showCommandOutput(command: string, output: string): Promise<void>;
}

const PROMPT = '\x1b[36m$\x1b[0m ';

function formatTerminalError(err: unknown): string {
  return `\x1b[31mError: ${err instanceof Error ? err.message : String(err)}\x1b[0m`;
}

export const TerminalComponent = forwardRef<TerminalHandle, TerminalProps>(function TerminalComponent(
  { runtime, welcomeMessage, onCommand }: TerminalProps,
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const inputRef = useRef('');
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const busyRef = useRef(false);

  const writePrompt = useCallback(() => {
    termRef.current?.write(PROMPT);
  }, []);

  const recordCommand = useCallback((command: string) => {
    historyRef.current.push(command);
    historyIndexRef.current = -1;
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

  const runCommandInTerminal = useCallback(
    async (
      command: string,
      options: {
        echoCommand: boolean;
        leadingBlankLine?: boolean;
        output?: string;
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
        writePrompt();
        return '';
      }

      recordCommand(command);
      busyRef.current = true;

      try {
        if (options.echoCommand) {
          term.write(PROMPT);
          term.writeln(command);
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
        writePrompt();
      }
    },
    [onCommand, recordCommand, runtime, writeOutput, writePrompt],
  );

  const executeTypedCommand = useCallback(
    async (cmd: string): Promise<string> => {
      return runCommandInTerminal(cmd, { echoCommand: false, leadingBlankLine: true });
    },
    [runCommandInTerminal],
  );

  const showCommandOutput = useCallback(
    async (command: string, output: string): Promise<void> => {
      await runCommandInTerminal(command, { echoCommand: true, output });
    },
    [runCommandInTerminal],
  );

  const runProgrammaticCommand = useCallback(
    async (command: string): Promise<string> => {
      return runCommandInTerminal(command, { echoCommand: true });
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
    writePrompt();

    term.onKey(({ key, domEvent }) => {
      if (busyRef.current) return;

      if (domEvent.key === 'Enter') {
        const cmd = inputRef.current;
        inputRef.current = '';
        void executeTypedCommand(cmd);
        return;
      }

      if (domEvent.key === 'Backspace') {
        if (inputRef.current.length > 0) {
          inputRef.current = inputRef.current.slice(0, -1);
          term.write('\b \b');
        }
        return;
      }

      if (domEvent.key === 'ArrowUp') {
        const history = historyRef.current;
        if (history.length === 0) return;
        if (historyIndexRef.current === -1) {
          historyIndexRef.current = history.length - 1;
        } else if (historyIndexRef.current > 0) {
          historyIndexRef.current--;
        }
        const entry = history[historyIndexRef.current];
        // Clear current input
        while (inputRef.current.length > 0) {
          term.write('\b \b');
          inputRef.current = inputRef.current.slice(0, -1);
        }
        inputRef.current = entry;
        term.write(entry);
        return;
      }

      if (domEvent.key === 'ArrowDown') {
        const history = historyRef.current;
        while (inputRef.current.length > 0) {
          term.write('\b \b');
          inputRef.current = inputRef.current.slice(0, -1);
        }
        if (historyIndexRef.current >= 0 && historyIndexRef.current < history.length - 1) {
          historyIndexRef.current++;
          const entry = history[historyIndexRef.current];
          inputRef.current = entry;
          term.write(entry);
        } else {
          historyIndexRef.current = -1;
          inputRef.current = '';
        }
        return;
      }

      // Ignore other control keys
      if (domEvent.ctrlKey || domEvent.altKey || domEvent.metaKey) return;
      if (key.length === 1 && key.charCodeAt(0) >= 32) {
        inputRef.current += key;
        term.write(key);
      }
    });

    const resizeObserver = new ResizeObserver(() => fitAddon.fit());
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, [welcomeMessage, writePrompt, executeTypedCommand]);

  return (
    <div
      ref={containerRef}
      style={{
        width: '100%',
        height: '100%',
        minHeight: '400px',
        borderRadius: '8px',
        overflow: 'hidden',
        border: '1px solid var(--border)',
      }}
    />
  );
});

export default TerminalComponent;
