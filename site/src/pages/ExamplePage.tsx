import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getExample } from '../examples';
import { sourceBaseUrl } from '../config';
import { TerminalComponent, type TerminalHandle } from '../components/Terminal';
import { createRuntimeForExample } from '../runtime/create-runtime';
import type { AgentCLI, RunExecution } from 'one-tool/browser';

function ExamplePage() {
  const { id } = useParams<{ id: string }>();
  const example = id ? getExample(id) : undefined;
  const [runtime, setRuntime] = useState<AgentCLI | null>(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const terminalRef = useRef<TerminalHandle | null>(null);
  const sourceUrl = example ? new URL(example.sourceFile, sourceBaseUrl).href : '';

  useEffect(() => {
    if (!example?.browserRunnable || !example.runtimeKind) {
      setRuntime(null);
      setRuntimeError('');
      setStepIndex(0);
      return;
    }

    let cancelled = false;
    let createdRuntime: AgentCLI | null = null;
    setRuntime(null);
    setRuntimeError('');
    setStepIndex(0);

    void createRuntimeForExample(example.runtimeKind)
      .then((nextRuntime) => {
        createdRuntime = nextRuntime;
        if (cancelled) {
          const vfs = nextRuntime.ctx.vfs;
          if ('close' in vfs && typeof vfs.close === 'function') {
            vfs.close();
          }
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
      const vfs = createdRuntime?.ctx.vfs;
      if (vfs && 'close' in vfs && typeof vfs.close === 'function') {
        vfs.close();
      }
    };
  }, [example]);

  const handleRunStep = useCallback(async () => {
    const terminal = terminalRef.current;
    if (!runtime || !terminal || !example?.steps || stepIndex >= example.steps.length) return;
    const step = example.steps[stepIndex];

    if (example.executionKind === 'runDetailed') {
      const execution = await runtime.runDetailed(step.command);
      await terminal.showCommandOutput(step.command, formatDetailedExecution(execution));
    } else {
      await terminal.runCommand(step.command);
    }

    setStepIndex((i) => i + 1);
  }, [runtime, example, stepIndex]);

  if (!example) {
    return (
      <div style={containerStyle}>
        <p>Example not found.</p>
        <Link to="/examples">Back to examples</Link>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <div style={{ marginBottom: '1.5rem' }}>
        <Link to="/examples" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          &larr; All examples
        </Link>
        <h1 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-mono)', marginTop: '0.5rem' }}>
          {example.title}
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{example.description}</p>
      </div>

      {!example.browserRunnable ? (
        <div style={nonInteractiveStyle}>
          <p style={{ marginBottom: '1rem' }}>This example requires Node.js and cannot run in the browser.</p>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            View the source:{' '}
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
              {example.sourceFile}
            </a>
          </p>
          {example.requiresApiKey && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
              Requires an API key to run.
            </p>
          )}
        </div>
      ) : (
        <>
          {runtimeError && (
            <div style={errorStyle}>
              <strong>Failed to initialize example.</strong>
              <div style={{ marginTop: '0.35rem' }}>{runtimeError}</div>
            </div>
          )}
          {example.steps && example.steps.length > 0 && (
            <div style={{ marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
                Steps
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {example.steps.map((step, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.75rem',
                      padding: '0.5rem 0.75rem',
                      background: i < stepIndex ? 'var(--bg-hover)' : 'transparent',
                      borderRadius: '6px',
                      opacity: i < stepIndex ? 0.6 : 1,
                    }}
                  >
                    <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', minWidth: '1.5rem' }}>
                      {i < stepIndex ? '\u2713' : `${i + 1}.`}
                    </span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      {step.explanation}
                    </span>
                    <code style={{ fontSize: '0.8rem', marginLeft: 'auto' }}>{step.command}</code>
                  </div>
                ))}
              </div>
              {stepIndex < example.steps.length && (
                <button
                  onClick={handleRunStep}
                  style={buttonStyle}
                  disabled={!runtime || Boolean(runtimeError)}
                >
                  Run next step
                </button>
              )}
              {stepIndex >= example.steps.length && (
                <p style={{ fontSize: '0.85rem', color: 'var(--green)', marginTop: '0.75rem' }}>
                  All steps complete. Try your own commands below.
                </p>
              )}
            </div>
          )}

          {runtime ? (
            <div style={{ height: '400px' }}>
              <TerminalComponent ref={terminalRef} runtime={runtime} />
            </div>
          ) : (
            <div className="loading">Initializing runtime...</div>
          )}
        </>
      )}
    </div>
  );
}

export default ExamplePage;

function formatDetailedExecution(execution: RunExecution): string {
  const lines = [
    'Structured execution',
    `exit: ${execution.exitCode}`,
    `durationMs: ${execution.durationMs.toFixed(2)}`,
    `stdoutMode: ${execution.presentation.stdoutMode}`,
    `pipelines: ${execution.trace.length}`,
    'commands:',
  ];

  for (const pipeline of execution.trace) {
    for (const command of pipeline.commands) {
      lines.push(
        `  - ${command.argv.join(' ')} -> exit ${command.exitCode}, stdout ${command.stdoutBytes} bytes`,
      );
    }
  }

  lines.push('', 'presentation:', execution.presentation.text);
  return lines.join('\n');
}

const containerStyle: React.CSSProperties = {
  maxWidth: 'var(--max-width)',
  margin: '0 auto',
  padding: '1.5rem',
};

const nonInteractiveStyle: React.CSSProperties = {
  padding: '2rem',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  textAlign: 'center',
};

const buttonStyle: React.CSSProperties = {
  marginTop: '0.75rem',
  padding: '0.5rem 1rem',
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  fontWeight: 600,
  fontSize: '0.85rem',
  cursor: 'pointer',
};

const errorStyle: React.CSSProperties = {
  marginBottom: '1rem',
  padding: '0.75rem 1rem',
  background: 'rgba(248, 81, 73, 0.12)',
  border: '1px solid rgba(248, 81, 73, 0.3)',
  borderRadius: '8px',
  color: 'var(--text)',
  fontSize: '0.85rem',
};
