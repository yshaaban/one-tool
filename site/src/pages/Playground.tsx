import { useState, useEffect } from 'react';
import { TerminalComponent } from '../components/Terminal';
import { closeRuntime, createDemoRuntime } from '../runtime/create-runtime';
import type { AgentCLI } from 'one-tool/browser';

const WELCOME = [
  '\x1b[38;5;81mone-tool playground\x1b[0m',
  '',
  'Type \x1b[38;5;229mhelp\x1b[0m to list commands.',
  'Use \x1b[38;5;229mTab\x1b[0m for autocomplete and \x1b[38;5;229m\u2191\u2193\x1b[0m for history.',
  '',
  'Try:',
  '  \x1b[38;5;114mls /\x1b[0m',
  '  \x1b[38;5;114mcat /logs/app.log\x1b[0m',
  '  \x1b[38;5;114mgrep -c ERROR /logs/app.log\x1b[0m',
  '  \x1b[38;5;114mfetch order:123 | json get customer.email\x1b[0m',
  '  \x1b[38;5;114msearch refund timeout\x1b[0m',
].join('\r\n');

function Playground() {
  const [runtime, setRuntime] = useState<AgentCLI | null>(null);
  const [runtimeError, setRuntimeError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let createdRuntime: AgentCLI | null = null;

    createDemoRuntime()
      .then((nextRuntime) => {
        createdRuntime = nextRuntime;
        if (cancelled) {
          closeRuntime(nextRuntime);
          return;
        }
        setRuntime(nextRuntime);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setRuntimeError(caught instanceof Error ? caught.message : String(caught));
        }
      });

    return () => {
      cancelled = true;
      closeRuntime(createdRuntime);
    };
  }, []);

  if (runtimeError) {
    return (
      <div style={containerStyle}>
        <div style={errorStyle}>
          <strong>Failed to initialize playground.</strong>
          <div style={{ marginTop: '0.5rem', color: 'var(--text-muted)' }}>{runtimeError}</div>
        </div>
      </div>
    );
  }

  if (!runtime) {
    return <div className="loading">Initializing</div>;
  }

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>Playground</h1>
        <p style={subtitleStyle}>
          Interactive CLI running entirely in your browser. Pre-loaded with demo files, search, and fetch
          adapters.
        </p>
      </div>
      <div style={terminalWrapperStyle}>
        <TerminalComponent runtime={runtime} welcomeMessage={WELCOME} />
      </div>
    </div>
  );
}

export default Playground;

const containerStyle: React.CSSProperties = {
  maxWidth: 'var(--max-width)',
  margin: '0 auto',
  padding: '1.5rem',
};

const headerStyle: React.CSSProperties = {
  marginBottom: '1rem',
};

const titleStyle: React.CSSProperties = {
  fontSize: '1.4rem',
  fontFamily: 'var(--font-mono)',
  fontWeight: 700,
  color: 'var(--text-bright)',
  letterSpacing: '-0.02em',
};

const subtitleStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '0.88rem',
  marginTop: '0.25rem',
};

const terminalWrapperStyle: React.CSSProperties = {
  height: 'calc(100vh - 180px)',
  minHeight: '450px',
};

const errorStyle: React.CSSProperties = {
  padding: '1rem',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
};
