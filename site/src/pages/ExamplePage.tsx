import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getExample } from '../examples';
import { sourceBaseUrl } from '../config';
import { TerminalComponent, type TerminalHandle, type TerminalPlaybackOptions } from '../components/Terminal';
import { closeRuntime, createRuntimeForExample } from '../runtime/create-runtime';
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
  const handleTerminalReady = useCallback(() => {
    setTerminalReady(true);
  }, []);

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
    const currentExample = example;
    const steps = example?.steps;
    if (!runtime || !terminalReady || runtimeError || !steps?.length || !currentExample?.autoPlay) {
      return;
    }

    let cancelled = false;
    setIsAutoplaying(true);

    void (async () => {
      await sleep(AUTO_PLAY_START_DELAY_MS);
      for (let index = 0; index < steps.length; index += 1) {
        if (cancelled) {
          return;
        }

        await runExampleStep(index, { animate: true, typingDelayMs: AUTO_PLAY_TYPING_DELAY_MS });
        if (cancelled || index >= steps.length - 1) {
          continue;
        }
        await sleep(currentExample.stepDelayMs ?? 800);
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

  const totalSteps = example.steps?.length ?? 0;
  const allDone = stepIndex >= totalSteps;

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <Link to="/examples" style={backLinkStyle}>
          <span style={{ marginRight: '0.3rem' }}>&larr;</span> Examples
        </Link>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginTop: '0.5rem' }}>
          <span style={exampleNumberStyle}>{example.id.slice(0, 2)}</span>
          <h1 style={titleStyle}>{example.title}</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginTop: '0.35rem' }}>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem' }}>{example.description}</p>
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={sourceLinkStyle}>
            Source
          </a>
        </div>
      </div>

      {!example.browserRunnable ? (
        <div style={nonInteractiveStyle}>
          <div style={{ fontSize: '1.5rem', marginBottom: '0.75rem', opacity: 0.4 }}>{'{ }'}</div>
          <p style={{ marginBottom: '0.75rem', fontWeight: 500 }}>Requires Node.js</p>
          <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)' }}>
            This example cannot run in the browser.{' '}
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer">
              View the source code
            </a>
          </p>
        </div>
      ) : (
        <>
          {runtimeError && (
            <div style={errorStyle}>
              <strong>Failed to initialize example.</strong>
              <div style={{ marginTop: '0.35rem' }}>{runtimeError}</div>
            </div>
          )}

          {/* Steps + Terminal in a two-column layout on wide screens */}
          <div style={mainLayoutStyle}>
            {/* Steps panel */}
            {example.steps && totalSteps > 0 && (
              <div style={stepsPanelStyle}>
                <div style={stepsPanelHeaderStyle}>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.72rem',
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: 'var(--text-muted)',
                    }}
                  >
                    Steps
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: '0.72rem',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {stepIndex}/{totalSteps}
                  </span>
                </div>

                {/* Progress bar */}
                <div style={progressTrackStyle}>
                  <div
                    style={{
                      ...progressFillStyle,
                      width: `${(stepIndex / totalSteps) * 100}%`,
                    }}
                  />
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                  {example.steps.map((step, i) => {
                    const completed = i < stepIndex;
                    const active = i === runningStepIndex;
                    const current = i === stepIndex && !active;

                    return (
                      <div
                        key={i}
                        style={{
                          ...stepItemStyle,
                          background: active
                            ? 'var(--accent-dim)'
                            : completed
                              ? 'rgba(255,255,255,0.02)'
                              : 'transparent',
                          borderColor: active ? 'rgba(110, 180, 255, 0.3)' : 'transparent',
                          opacity: completed ? 0.55 : 1,
                          animation: `slideInLeft 0.3s ${i * 0.05}s both`,
                        }}
                      >
                        <span style={stepIndicatorStyle(completed, active, current)}>
                          {completed ? '\u2713' : active ? '\u2026' : `${i + 1}`}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: '0.82rem',
                              color: 'var(--text-muted)',
                              marginBottom: '0.15rem',
                            }}
                          >
                            {step.explanation}
                          </div>
                          <code style={stepCommandStyle}>{step.command}</code>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Actions */}
                <div style={actionsStyle}>
                  {!allDone && (
                    <button
                      onClick={handleRunStep}
                      style={buttonStyle}
                      disabled={
                        !runtime || Boolean(runtimeError) || isAutoplaying || runningStepIndex !== null
                      }
                    >
                      {getRunStepButtonLabel(isAutoplaying, runningStepIndex)}
                    </button>
                  )}
                  {(stepIndex > 0 || isAutoplaying) && (
                    <button
                      onClick={handleReplay}
                      style={secondaryButtonStyle}
                      disabled={isAutoplaying || runningStepIndex !== null}
                    >
                      Replay
                    </button>
                  )}
                </div>

                {allDone && (
                  <div style={completeBannerStyle}>
                    All steps complete. Try your own commands in the terminal.
                  </div>
                )}
              </div>
            )}

            {/* Terminal */}
            <div style={terminalContainerStyle}>
              {runtime ? (
                <TerminalComponent
                  ref={terminalRef}
                  runtime={runtime}
                  readOnly={isAutoplaying}
                  onReady={handleTerminalReady}
                />
              ) : runtimeError ? (
                <div style={nonInteractiveStyle}>
                  <p>Runtime could not be initialized.</p>
                  <p style={{ fontSize: '0.84rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                    Reload the page or check the browser console.
                  </p>
                </div>
              ) : (
                <div className="loading">Initializing</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default ExamplePage;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function getRunStepButtonLabel(isAutoplaying: boolean, runningStepIndex: number | null): string {
  if (isAutoplaying) return 'Auto-playing...';
  if (runningStepIndex !== null) return 'Running...';
  return 'Run next step';
}

function stepIndicatorStyle(completed: boolean, active: boolean, current: boolean): React.CSSProperties {
  let bg = 'transparent';
  let color = 'var(--text-muted)';
  let border = '1px solid var(--border)';

  if (completed) {
    bg = 'var(--green-dim)';
    color = 'var(--green)';
    border = '1px solid rgba(74, 230, 138, 0.25)';
  } else if (active) {
    bg = 'var(--accent-dim)';
    color = 'var(--accent)';
    border = '1px solid rgba(110, 180, 255, 0.3)';
  } else if (current) {
    color = 'var(--text-bright)';
    border = '1px solid var(--border)';
  }

  return {
    width: '1.5rem',
    height: '1.5rem',
    borderRadius: '999px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.68rem',
    fontFamily: 'var(--font-mono)',
    fontWeight: 600,
    flexShrink: 0,
    background: bg,
    color,
    border,
  };
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  maxWidth: 'var(--max-width)',
  margin: '0 auto',
  padding: '1.5rem',
};

const headerStyle: React.CSSProperties = {
  marginBottom: '1.5rem',
};

const backLinkStyle: React.CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--text-muted)',
  textDecoration: 'none',
  fontWeight: 500,
  transition: 'color var(--transition)',
};

const exampleNumberStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: 'var(--accent)',
  background: 'var(--accent-dim)',
  padding: '0.2rem 0.5rem',
  borderRadius: '4px',
};

const titleStyle: React.CSSProperties = {
  fontSize: '1.4rem',
  fontFamily: 'var(--font-mono)',
  fontWeight: 700,
  color: 'var(--text-bright)',
  letterSpacing: '-0.02em',
};

const sourceLinkStyle: React.CSSProperties = {
  fontSize: '0.78rem',
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-muted)',
  textDecoration: 'none',
  border: '1px solid var(--border)',
  padding: '0.2rem 0.5rem',
  borderRadius: '4px',
  flexShrink: 0,
  transition: 'border-color var(--transition)',
};

const mainLayoutStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '280px 1fr',
  gap: '1rem',
  alignItems: 'start',
};

const stepsPanelStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius)',
  padding: '1rem',
  position: 'sticky',
  top: '4.5rem',
};

const stepsPanelHeaderStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: '0.6rem',
};

const progressTrackStyle: React.CSSProperties = {
  height: '2px',
  background: 'var(--border)',
  borderRadius: '1px',
  marginBottom: '0.85rem',
  overflow: 'hidden',
};

const progressFillStyle: React.CSSProperties = {
  height: '100%',
  background: 'var(--green)',
  borderRadius: '1px',
  transition: 'width 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
};

const stepItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.6rem',
  padding: '0.5rem 0.55rem',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid transparent',
  transition: 'all var(--transition)',
};

const stepCommandStyle: React.CSSProperties = {
  fontSize: '0.74rem',
  fontFamily: 'var(--font-mono)',
  color: 'var(--accent)',
  background: 'var(--bg-elevated)',
  padding: '0.1rem 0.35rem',
  borderRadius: '3px',
  border: '1px solid var(--border-subtle)',
  display: 'inline-block',
  maxWidth: '100%',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  marginTop: '0.85rem',
};

const buttonStyle: React.CSSProperties = {
  padding: '0.4rem 0.85rem',
  background: 'var(--accent)',
  color: '#0a0e14',
  border: 'none',
  borderRadius: 'var(--radius-sm)',
  fontWeight: 600,
  fontSize: '0.78rem',
  fontFamily: 'var(--font-sans)',
  cursor: 'pointer',
  transition: 'all var(--transition)',
};

const secondaryButtonStyle: React.CSSProperties = {
  ...buttonStyle,
  background: 'transparent',
  color: 'var(--text)',
  border: '1px solid var(--border)',
};

const completeBannerStyle: React.CSSProperties = {
  marginTop: '0.75rem',
  fontSize: '0.78rem',
  fontFamily: 'var(--font-mono)',
  color: 'var(--green)',
  background: 'var(--green-dim)',
  padding: '0.5rem 0.65rem',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid rgba(74, 230, 138, 0.2)',
};

const terminalContainerStyle: React.CSSProperties = {
  height: 'calc(100vh - 180px)',
  minHeight: '450px',
};

const nonInteractiveStyle: React.CSSProperties = {
  padding: '3rem 2rem',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius)',
  textAlign: 'center',
};

const errorStyle: React.CSSProperties = {
  marginBottom: '1rem',
  padding: '0.75rem 1rem',
  background: 'var(--red-dim)',
  border: '1px solid rgba(247, 108, 108, 0.3)',
  borderRadius: 'var(--radius)',
  color: 'var(--text)',
  fontSize: '0.85rem',
};
