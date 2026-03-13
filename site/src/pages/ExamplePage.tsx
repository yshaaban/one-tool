import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getExample } from '../examples';
import { sourceBaseUrl } from '../config';
import {
  TerminalComponent,
  type TerminalHandle,
  type TerminalPlaybackOptions,
} from '../components/Terminal';
import { createRuntimeForExample } from '../runtime/create-runtime';
import type { AgentCLI, RunExecution } from 'one-tool/browser';

const AgentPage = lazy(() => import('./AgentPage'));
const AUTO_PLAY_TYPING_DELAY_MS = 20;
const AUTO_PLAY_START_DELAY_MS = 500;

function ExamplePage() {
  const { id } = useParams<{ id: string }>();
  const example = id ? getExample(id) : undefined;
  const [runtime, setRuntime] = useState<AgentCLI | null>(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [stepIndex, setStepIndex] = useState(0);
  const [runningStepIndex, setRunningStepIndex] = useState<number | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);
  const [isAutoplaying, setIsAutoplaying] = useState(false);
  const [runtimeNonce, setRuntimeNonce] = useState(0);
  const terminalRef = useRef<TerminalHandle | null>(null);
  const sourceUrl = example ? new URL(example.sourceFile, sourceBaseUrl).href : '';

  useEffect(() => {
    if (!example?.browserRunnable || !example.runtimeKind) {
      setRuntime(null);
      setRuntimeError('');
      setStepIndex(0);
      setRunningStepIndex(null);
      setTerminalReady(false);
      setIsAutoplaying(false);
      return;
    }

    let cancelled = false;
    let createdRuntime: AgentCLI | null = null;
    setRuntime(null);
    setRuntimeError('');
    setStepIndex(0);
    setRunningStepIndex(null);
    setTerminalReady(false);
    setIsAutoplaying(false);

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
  }, [example, runtimeNonce]);

  const runExampleStep = useCallback(
    async (stepNumber: number, playback?: TerminalPlaybackOptions): Promise<void> => {
      const terminal = terminalRef.current;
      if (!runtime || !terminal || !example?.steps || stepNumber >= example.steps.length) {
        return;
      }

      const step = example.steps[stepNumber];
      setRunningStepIndex(stepNumber);

      try {
        if (example.executionKind === 'runDetailed') {
          const execution = await runtime.runDetailed(step.command);
          await terminal.showCommandOutput(step.command, formatDetailedExecution(execution), playback);
        } else {
          await terminal.runCommand(step.command, playback);
        }
        setStepIndex(stepNumber + 1);
      } finally {
        setRunningStepIndex(null);
      }
    },
    [example, runtime],
  );

  const handleRunStep = useCallback(async () => {
    if (!example?.steps || stepIndex >= example.steps.length || isAutoplaying) {
      return;
    }

    await runExampleStep(stepIndex, { animate: true, typingDelayMs: AUTO_PLAY_TYPING_DELAY_MS });
  }, [example, isAutoplaying, runExampleStep, stepIndex]);

  useEffect(() => {
    if (!runtime || !terminalReady || runtimeError || !example?.steps?.length || !example.autoPlay) {
      return;
    }

    let cancelled = false;
    setIsAutoplaying(true);

    void (async () => {
      await sleep(AUTO_PLAY_START_DELAY_MS);
      for (let index = 0; index < example.steps.length; index += 1) {
        if (cancelled) {
          return;
        }

        await runExampleStep(index, { animate: true, typingDelayMs: AUTO_PLAY_TYPING_DELAY_MS });
        if (cancelled || index >= example.steps.length - 1) {
          continue;
        }
        await sleep(example.stepDelayMs ?? 800);
      }
    })().finally(() => {
      if (!cancelled) {
        setIsAutoplaying(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [example, runExampleStep, runtime, runtimeError, terminalReady]);

  const handleReplay = useCallback(() => {
    if (isAutoplaying || runningStepIndex !== null) {
      return;
    }
    setRuntimeNonce((value) => value + 1);
  }, [isAutoplaying, runningStepIndex]);

  if (!example) {
    return (
      <div style={containerStyle}>
        <p>Example not found.</p>
        <Link to="/examples">Back to examples</Link>
      </div>
    );
  }

  if (example.browserRunnable && example.requiresApiKey) {
    return (
      <Suspense fallback={<div className="loading">Loading agent page...</div>}>
        <AgentPage example={example} />
      </Suspense>
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
                {example.steps.map((step, i) => {
                  return (
                    <div
                      key={i}
                      style={getStepCardStyle(i, stepIndex, runningStepIndex)}
                    >
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', minWidth: '1.5rem' }}>
                        {getStepStatusLabel(i, stepIndex, runningStepIndex)}
                      </span>
                      <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                        {step.explanation}
                      </span>
                      <code style={{ fontSize: '0.8rem', marginLeft: 'auto' }}>{step.command}</code>
                    </div>
                  );
                })}
              </div>
              <div style={actionsStyle}>
                {stepIndex < example.steps.length && (
                  <button
                    onClick={handleRunStep}
                    style={buttonStyle}
                    disabled={!runtime || Boolean(runtimeError) || isAutoplaying || runningStepIndex !== null}
                  >
                    {isAutoplaying ? 'Auto-playing...' : runningStepIndex !== null ? 'Running step...' : 'Run next step'}
                  </button>
                )}
                {(stepIndex > 0 || isAutoplaying) && (
                  <button
                    onClick={handleReplay}
                    style={secondaryButtonStyle}
                    disabled={isAutoplaying || runningStepIndex !== null}
                  >
                    Replay example
                  </button>
                )}
              </div>
              {stepIndex >= example.steps.length && (
                <p style={{ fontSize: '0.85rem', color: 'var(--green)', marginTop: '0.75rem' }}>
                  All steps complete. Try your own commands below.
                </p>
              )}
            </div>
          )}

          {runtime ? (
            <div style={{ height: '400px' }}>
              <TerminalComponent
                ref={terminalRef}
                runtime={runtime}
                readOnly={isAutoplaying}
                onReady={() => setTerminalReady(true)}
              />
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

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

function getStepCardStyle(index: number, stepIndex: number, runningStepIndex: number | null): React.CSSProperties {
  const active = index === runningStepIndex;
  const completed = index < stepIndex;

  let background = 'transparent';
  if (active) {
    background = 'rgba(88, 166, 255, 0.12)';
  } else if (completed) {
    background = 'var(--bg-hover)';
  }

  return {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.5rem 0.75rem',
    background,
    border: active ? '1px solid rgba(88, 166, 255, 0.35)' : '1px solid transparent',
    borderRadius: '6px',
    opacity: completed ? 0.6 : 1,
  };
}

function getStepStatusLabel(index: number, stepIndex: number, runningStepIndex: number | null): string {
  if (index < stepIndex) {
    return '\u2713';
  }
  if (index === runningStepIndex) {
    return '\u2026';
  }
  return `${index + 1}.`;
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
  padding: '0.5rem 1rem',
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: '6px',
  fontWeight: 600,
  fontSize: '0.85rem',
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.65rem',
  marginTop: '0.75rem',
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
