import { useState, useEffect } from 'react';
import { TerminalComponent } from '../components/Terminal';
import { createDemoRuntime } from '../runtime/create-runtime';
import type { AgentCLI } from 'one-tool/browser';

const WELCOME = [
  '\x1b[36mone-tool playground\x1b[0m',
  '',
  'Type \x1b[33mhelp\x1b[0m to list commands, or try:',
  '  \x1b[32mls /\x1b[0m',
  '  \x1b[32mcat /logs/app.log\x1b[0m',
  '  \x1b[32mgrep -c ERROR /logs/app.log\x1b[0m',
  '  \x1b[32mfetch order:123 | json get customer.email\x1b[0m',
  '  \x1b[32msearch refund timeout\x1b[0m',
].join('\r\n');

function Playground() {
  const [runtime, setRuntime] = useState<AgentCLI | null>(null);

  useEffect(() => {
    createDemoRuntime().then(setRuntime);
  }, []);

  if (!runtime) {
    return <div className="loading">Initializing runtime...</div>;
  }

  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '1.5rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-mono)' }}>Playground</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          Interactive CLI running entirely in your browser. Files, search, and fetch are pre-loaded with demo
          data.
        </p>
      </div>
      <div style={{ height: 'calc(100vh - 200px)', minHeight: '400px' }}>
        <TerminalComponent runtime={runtime} welcomeMessage={WELCOME} />
      </div>
    </div>
  );
}

export default Playground;
