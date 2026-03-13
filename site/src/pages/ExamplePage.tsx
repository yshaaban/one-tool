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

      {example.id === '07-mcp-server' ? (
        <McpGuide sourceUrl={sourceUrl} />
      ) : !example.browserRunnable ? (
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

function McpGuide({ sourceUrl }: { sourceUrl: string }): React.ReactNode {
  return (
    <div style={mcpGuideStyle}>
      <McpStep
        index={1}
        title="Choose a setup"
        animationDelay="0s"
        description="Use the repo directly or add the package to an existing Node project."
      >
        <div style={mcpChoiceGridStyle}>
          <div style={mcpChoiceCardStyle}>
            <h3 style={mcpChoiceTitleStyle}>Try the repo example</h3>
            <McpCodeBlock
              filename="terminal"
              code={`git clone https://github.com/yshaaban/one-tool.git\ncd one-tool\nnpm install`}
            />
          </div>
          <div style={mcpChoiceCardStyle}>
            <h3 style={mcpChoiceTitleStyle}>Add it to an existing project</h3>
            <McpCodeBlock filename="terminal" code={`npm install one-tool`} />
          </div>
        </div>
      </McpStep>

      <McpStep
        index={2}
        title="Create the server"
        animationDelay="0.08s"
        description="Create a small Node entrypoint that exposes the runtime over stdio."
      >
        <McpCodeBlock
          filename="mcp-server.js"
          code={`import { createAgentCLI, NodeVFS } from 'one-tool';\nimport { serveStdioMcpServer } from 'one-tool/mcp';\n\nconst runtime = await createAgentCLI({\n  vfs: new NodeVFS('./workspace'),\n});\n\nawait serveStdioMcpServer(runtime, {\n  instructions: 'Use the run tool to inspect files, memory, and adapters.',\n});`}
        />
        <p style={mcpNoteStyle}>
          <code style={inlineCodeStyle}>NodeVFS('./workspace')</code> scopes file access to the{' '}
          <code style={inlineCodeStyle}>workspace/</code> directory.
        </p>
      </McpStep>

      <McpStep
        index={3}
        title="Connect your client"
        animationDelay="0.16s"
        description="Use Claude Code from the CLI."
      >
        <div style={mcpClientStackStyle}>
          {MCP_CLIENTS.map((client) => (
            <McpClientCard key={client.name} client={client} />
          ))}
        </div>
      </McpStep>

      <McpStep
        index={4}
        title="What you get"
        animationDelay="0.24s"
        description="After the client connects, the model gets one run tool. Ask for outcomes in natural language and it composes commands internally."
      >
        <p style={mcpNoteStyle}>
          Expect one tool named <code style={inlineCodeStyle}>run</code>. The model can inspect files, search,
          fetch, and compose commands with pipes, <code style={inlineCodeStyle}>&amp;&amp;</code>,{' '}
          <code style={inlineCodeStyle}>||</code>, and <code style={inlineCodeStyle}>;</code>.
        </p>
        <McpCodeBlock
          filename="prompts"
          code={`List the files in the workspace.\nCheck /logs/app.log for ERROR lines.\nFetch order 123 and tell me the customer email.\nSearch for refund timeout guidance and summarize it.`}
        />
      </McpStep>

      <McpStep index={5} title="Customize" animationDelay="0.32s" description="Optional server settings.">
        <div style={mcpTableShellStyle}>
          <table style={mcpTableStyle}>
            <thead>
              <tr>
                <th style={mcpTableHeadingStyle}>Option</th>
                <th style={mcpTableHeadingStyle}>Type</th>
                <th style={mcpTableHeadingStyle}>Default</th>
                <th style={mcpTableHeadingStyle}>Purpose</th>
              </tr>
            </thead>
            <tbody>
              {MCP_OPTION_ROWS.map((row, index) => (
                <tr key={row.name} style={index % 2 === 0 ? mcpTableRowAltStyle : undefined}>
                  <td style={mcpTableCodeCellStyle}>{row.name}</td>
                  <td style={mcpTableCodeCellStyle}>{row.type}</td>
                  <td style={mcpTableCodeCellStyle}>{row.defaultValue}</td>
                  <td style={mcpTableCellStyle}>{row.purpose}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </McpStep>

      <div style={mcpFooterStyle}>
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={sourceLinkStyle}>
          View source
        </a>
      </div>
    </div>
  );
}

function McpClientCard({ client }: { client: McpClientConfig }): React.ReactNode {
  return (
    <div style={mcpClientCardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.75rem' }}>
        <span style={{ ...mcpClientBadgeStyle, color: client.color, background: client.background }}>
          {client.name}
        </span>
        <span style={mcpClientPathStyle}>{client.location}</span>
      </div>
      <p style={mcpClientBodyStyle}>{client.description}</p>
      <McpCodeBlock filename={client.filename} code={client.code} />
    </div>
  );
}

function McpStep({
  index,
  title,
  description,
  animationDelay,
  children,
}: {
  index: number;
  title: string;
  description: string;
  animationDelay: string;
  children: React.ReactNode;
}): React.ReactNode {
  return (
    <section
      style={{
        ...mcpStepStyle,
        animation: `fadeInUp 0.4s ${animationDelay} both`,
      }}
    >
      <div style={mcpStepHeaderStyle}>
        <span style={mcpStepNumberStyle}>{index}</span>
        <div>
          <h2 style={mcpStepTitleStyle}>{title}</h2>
          <p style={mcpStepDescriptionStyle}>{description}</p>
        </div>
      </div>
      <div style={mcpStepBodyStyle}>{children}</div>
    </section>
  );
}

function McpCodeBlock({ filename, code }: { filename: string; code: string }): React.ReactNode {
  return (
    <div style={mcpCodeShellStyle}>
      <div style={mcpCodeHeaderStyle}>
        <div style={{ display: 'flex', gap: '0.35rem' }}>
          <span style={dot('#f76c6c')} />
          <span style={dot('#f0c761')} />
          <span style={dot('#4ae68a')} />
        </div>
        <span style={mcpCodeFilenameStyle}>{filename}</span>
      </div>
      <pre style={mcpCodeStyle}>{code}</pre>
    </div>
  );
}

function dot(color: string): React.CSSProperties {
  return {
    width: '0.55rem',
    height: '0.55rem',
    borderRadius: '999px',
    background: color,
    display: 'inline-block',
  };
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
  width: '100%',
  height: '100%',
  minHeight: 0,
  overflow: 'hidden',
  maxWidth: 'var(--max-width)',
  margin: '0 auto',
  padding: '1.5rem',
  display: 'grid',
  gridTemplateRows: 'auto 1fr',
};

const headerStyle: React.CSSProperties = {
  marginBottom: '1.5rem',
  minHeight: 0,
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

const inlineCodeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.8em',
  background: 'var(--bg-elevated)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '4px',
  padding: '0.08rem 0.35rem',
  color: 'var(--text-bright)',
};

interface McpClientConfig {
  name: string;
  location: string;
  description: React.ReactNode;
  filename: string;
  code: string;
  color: string;
  background: string;
}

const MCP_CLIENTS: readonly McpClientConfig[] = [
  {
    name: 'Claude Code',
    location: 'project root',
    description: (
      <>
        This writes the same stdio entry to <code style={inlineCodeStyle}>.mcp.json</code>.
      </>
    ),
    filename: 'terminal',
    code: `claude mcp add-json one-tool '{\n  \"type\": \"stdio\",\n  \"command\": \"node\",\n  \"args\": [\"./mcp-server.js\"]\n}'`,
    color: 'var(--accent)',
    background: 'var(--accent-dim)',
  },
];

const MCP_OPTION_ROWS = [
  {
    name: 'serverName',
    type: 'string',
    defaultValue: 'one-tool',
    purpose: 'Server name reported to the client',
  },
  {
    name: 'serverVersion',
    type: 'string',
    defaultValue: 'package version',
    purpose: 'Version reported to the client',
  },
  {
    name: 'instructions',
    type: 'string',
    defaultValue: '—',
    purpose: 'Extra instructions sent in MCP server metadata',
  },
  {
    name: 'toolName',
    type: 'string',
    defaultValue: 'run',
    purpose: 'Tool name exposed to the client',
  },
  {
    name: 'descriptionVariant',
    type: `'full-tool-description' | 'minimal-tool-description' | 'terse'`,
    defaultValue: `'full-tool-description'`,
    purpose: 'Controls how much tool description text is sent',
  },
] as const;

const mainLayoutStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '280px 1fr',
  gap: '1rem',
  alignItems: 'start',
  minHeight: 0,
};

const stepsPanelStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius)',
  padding: '1rem',
  minHeight: 0,
  overflow: 'auto',
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
  minHeight: 0,
  height: '100%',
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

const mcpGuideStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '760px',
  margin: '0 auto',
  overflow: 'auto',
  paddingBottom: '1rem',
};

const mcpStepStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius)',
  padding: '1.25rem',
  marginBottom: '1rem',
};

const mcpStepHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.85rem',
  marginBottom: '1rem',
};

const mcpStepNumberStyle: React.CSSProperties = {
  width: '1.8rem',
  height: '1.8rem',
  borderRadius: '999px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: '0.78rem',
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  color: 'var(--accent)',
  background: 'var(--accent-dim)',
  border: '1px solid rgba(110, 180, 255, 0.28)',
  flexShrink: 0,
};

const mcpStepTitleStyle: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 600,
  color: 'var(--text-bright)',
  marginBottom: '0.25rem',
};

const mcpStepDescriptionStyle: React.CSSProperties = {
  fontSize: '0.86rem',
  color: 'var(--text-muted)',
  lineHeight: 1.6,
};

const mcpStepBodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.9rem',
};

const mcpChoiceGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
  gap: '0.85rem',
};

const mcpChoiceCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.65rem',
};

const mcpChoiceTitleStyle: React.CSSProperties = {
  fontSize: '0.88rem',
  fontWeight: 600,
  color: 'var(--text-bright)',
};

const mcpCodeShellStyle: React.CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: '12px',
  overflow: 'hidden',
  background: 'var(--bg-elevated)',
};

const mcpCodeHeaderStyle: React.CSSProperties = {
  height: '2rem',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0 0.8rem',
  borderBottom: '1px solid var(--border-subtle)',
  background: 'rgba(255, 255, 255, 0.02)',
};

const mcpCodeFilenameStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.72rem',
  color: 'var(--text-muted)',
};

const mcpCodeStyle: React.CSSProperties = {
  margin: 0,
  padding: '0.9rem 1rem',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.79rem',
  lineHeight: 1.7,
  color: 'var(--text-bright)',
  background: 'var(--bg)',
  overflowX: 'auto',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const mcpNoteStyle: React.CSSProperties = {
  fontSize: '0.82rem',
  color: 'var(--text-muted)',
  lineHeight: 1.6,
};

const mcpClientStackStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.9rem',
};

const mcpClientCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
};

const mcpClientBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.18rem 0.55rem',
  borderRadius: '999px',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.68rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const mcpClientPathStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.72rem',
  color: 'var(--text-muted)',
};

const mcpClientBodyStyle: React.CSSProperties = {
  fontSize: '0.84rem',
  color: 'var(--text-muted)',
  lineHeight: 1.6,
};

const mcpTableShellStyle: React.CSSProperties = {
  overflowX: 'auto',
  border: '1px solid var(--border-subtle)',
  borderRadius: '12px',
};

const mcpTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  minWidth: '680px',
};

const mcpTableHeadingStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.75rem 0.9rem',
  fontSize: '0.74rem',
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  color: 'var(--text-muted)',
  background: 'var(--bg-elevated)',
  borderBottom: '1px solid var(--border-subtle)',
};

const mcpTableCellStyle: React.CSSProperties = {
  padding: '0.75rem 0.9rem',
  fontSize: '0.82rem',
  color: 'var(--text-muted)',
  borderTop: '1px solid var(--border-subtle)',
  verticalAlign: 'top',
  lineHeight: 1.55,
};

const mcpTableCodeCellStyle: React.CSSProperties = {
  ...mcpTableCellStyle,
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-bright)',
};

const mcpTableRowAltStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.015)',
};

const mcpFooterStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  paddingTop: '0.35rem',
};
