import { useCallback, useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link } from 'react-router-dom';
import type { AgentCLI } from '@onetool/one-tool/browser';
import { sourceBaseUrl } from '../config';
import type { ExampleDef } from '../examples/types';
import { closeRuntime, createDemoRuntime } from '../runtime/create-runtime';
import { tokenizeCommand, type CommandTokenKind } from '../utils/command-highlighting';
import {
  browserModelOptions,
  createAgentSession,
  createBrowserConfig,
  disposeAgentSession,
  runAgentTurn,
  type AgentSession,
} from '../runtime/browser-agent';

type UIMessage =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool-call'; command: string; result: string }
  | { kind: 'error'; text: string };

interface ActiveToolCall {
  command: string;
}

export default function AgentPage({ example }: { example: ExampleDef }) {
  const sourceUrl = new URL(example.sourceFile, sourceBaseUrl).href;

  const [runtime, setRuntime] = useState<AgentCLI | null>(null);
  const [runtimeError, setRuntimeError] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState(browserModelOptions[0]?.value ?? '');
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [activeToolCall, setActiveToolCall] = useState<ActiveToolCall | null>(null);

  const sessionRef = useRef<AgentSession | null>(null);
  const chatViewportRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const apiKeyInputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);
  const activeRequestIdRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let createdRuntime: AgentCLI | null = null;
    mountedRef.current = true;

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
      mountedRef.current = false;
      activeRequestIdRef.current += 1;
      disposeAgentSession(sessionRef.current);
      sessionRef.current = null;
      closeRuntime(createdRuntime);
    };
  }, []);

  useEffect(() => {
    const chatViewport = chatViewportRef.current;
    if (!chatViewport) {
      return;
    }

    chatViewport.scrollTo({
      top: chatViewport.scrollHeight,
      behavior: 'smooth',
    });
  }, [messages, busy]);

  const resetConversation = useCallback((nextInput?: string) => {
    setMessages([]);
    setInput(nextInput ?? '');
    setActiveToolCall(null);
    setBusy(false);
    activeRequestIdRef.current += 1;
    disposeAgentSession(sessionRef.current);
    sessionRef.current = null;
  }, []);

  const handleSend = useCallback(async () => {
    if (!runtime || busy) {
      return;
    }

    if (!apiKey.trim()) {
      apiKeyInputRef.current?.focus();
      return;
    }

    if (!input.trim()) {
      textareaRef.current?.focus();
      return;
    }

    const userText = input.trim();
    const requestId = activeRequestIdRef.current + 1;
    activeRequestIdRef.current = requestId;
    setInput('');
    setBusy(true);
    setActiveToolCall(null);
    setMessages((prev) => [...prev, { kind: 'user', text: userText }]);

    const config = createBrowserConfig(apiKey.trim(), model.trim() || undefined);

    if (!sessionRef.current) {
      sessionRef.current = createAgentSession(runtime);
    }

    try {
      const result = await runAgentTurn(runtime, config, userText, sessionRef.current, {
        onToolCallStart: (command) => {
          if (!mountedRef.current || activeRequestIdRef.current !== requestId) {
            return;
          }
          setActiveToolCall({ command });
        },
        onToolCallComplete: (command, toolResult) => {
          if (!mountedRef.current || activeRequestIdRef.current !== requestId) {
            return;
          }
          setActiveToolCall(null);
          setMessages((prev) => [...prev, { kind: 'tool-call', command, result: toolResult }]);
        },
      });

      if (!mountedRef.current || activeRequestIdRef.current !== requestId) {
        return;
      }
      setMessages((prev) => [...prev, { kind: 'assistant', text: result.reply }]);
    } catch (caught) {
      if (!mountedRef.current || activeRequestIdRef.current !== requestId) {
        return;
      }
      const errorText = caught instanceof Error ? caught.message : String(caught);
      setActiveToolCall(null);
      setMessages((prev) => [...prev, { kind: 'error', text: errorText }]);
    } finally {
      if (!mountedRef.current || activeRequestIdRef.current !== requestId) {
        return;
      }
      setActiveToolCall(null);
      setBusy(false);
    }
  }, [apiKey, busy, input, model, runtime]);

  const handleClear = useCallback(() => {
    resetConversation('');
    textareaRef.current?.focus();
  }, [resetConversation]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const handleSuggestedPrompt = useCallback(
    (prompt: string) => {
      setInput(prompt);
      if (!apiKey.trim()) {
        apiKeyInputRef.current?.focus();
        return;
      }
      textareaRef.current?.focus();
    },
    [apiKey],
  );

  const hasConversationState = messages.length > 0 || sessionRef.current !== null;
  const hasApiKey = apiKey.trim().length > 0;
  const canSend = Boolean(runtime && hasApiKey && input.trim() && !busy);

  const handleApiKeyChange = useCallback(
    (nextValue: string) => {
      if (nextValue !== apiKey && hasConversationState) {
        resetConversation(input);
      }
      setApiKey(nextValue);
    },
    [apiKey, hasConversationState, input, resetConversation],
  );

  const handleModelChange = useCallback(
    (nextValue: string) => {
      if (nextValue !== model && hasConversationState) {
        resetConversation(input);
      }
      setModel(nextValue);
    },
    [hasConversationState, input, model, resetConversation],
  );

  return (
    <div style={containerStyle}>
      <header style={headerStyle}>
        <div style={headerLeftStyle}>
          <div style={headerMetaStyle}>
            <Link to="/examples" style={backLinkStyle}>
              &larr; Examples
            </Link>
            <span style={experimentalBadgeStyle}>experimental</span>
          </div>
          <h1 style={titleStyle}>{example.title}</h1>
          <p style={headerSubtitleStyle}>
            This page shows a model using one <code style={headerInlineCodeStyle}>run(command)</code> tool
            over the demo workspace.
          </p>
        </div>
        <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={sourceLinkStyle}>
          Source &rarr;
        </a>
      </header>

      <section style={chatShellStyle}>
        <div ref={chatViewportRef} style={chatViewportStyle}>
          {runtimeError ? (
            <div style={runtimeErrorStyle}>
              <div style={errorLabelStyle}>Runtime error</div>
              <div>{runtimeError}</div>
            </div>
          ) : null}

          {!runtimeError && messages.length === 0 ? (
            <div style={emptyStateStyle}>
              <div style={emptyHeroStyle}>
                <div style={cursorHeroStyle}>
                  <span style={{ color: 'var(--accent)' }}>{'>'}</span>
                  <span style={{ color: 'var(--accent)', marginLeft: '0.35rem' }}>_</span>
                </div>
                <h2 style={emptyTitleStyle}>Suggested tasks</h2>
                <p style={emptySubtitleStyle}>Add your OpenRouter API key and run one of these prompts.</p>
              </div>

              {example.suggestedPrompts?.length ? (
                <div style={promptGridStyle}>
                  {example.suggestedPrompts.map((prompt, index) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => handleSuggestedPrompt(prompt)}
                      disabled={busy}
                      style={{
                        ...promptCardStyle,
                        animation: `fadeInUp 0.28s ${index * 0.05}s both`,
                      }}
                    >
                      <span style={promptCardLabelStyle}>Prompt</span>
                      <span style={promptCardTextStyle}>{prompt}</span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div style={messageListStyle}>
              {messages.map((message, index) => (
                <div key={`${message.kind}-${index}`} style={{ animation: 'fadeInUp 0.3s both' }}>
                  {renderMessage(message)}
                </div>
              ))}

              {activeToolCall ? (
                <div style={{ animation: 'fadeInUp 0.25s both' }}>{renderActiveToolCall(activeToolCall)}</div>
              ) : null}

              {busy ? (
                <div style={thinkingStyle}>
                  <span style={thinkingDotStyle} />
                  <span style={thinkingTextStyle}>
                    {activeToolCall ? 'Running tool' : 'Planning next step'}
                  </span>
                  <span style={thinkingCursorStyle} />
                </div>
              ) : null}
            </div>
          )}
        </div>
      </section>

      <footer style={inputDockStyle}>
        <div style={inputDockInnerStyle}>
          <div style={configRowStyle}>
            <label style={configFieldStyle}>
              <span style={configLabelRowStyle}>
                <span style={configLabelStyle}>OpenRouter API key</span>
                {!hasApiKey ? <span style={requiredBadgeStyle}>required</span> : null}
              </span>
              <input
                ref={apiKeyInputRef}
                type="password"
                value={apiKey}
                onChange={(event) => handleApiKeyChange(event.target.value)}
                placeholder="sk-or-v1-..."
                disabled={busy}
                style={{
                  ...fieldStyle,
                  width: '100%',
                  borderColor: hasApiKey ? 'var(--border)' : 'rgba(110, 180, 255, 0.32)',
                }}
              />
            </label>

            <label style={configFieldStyle}>
              <span style={configLabelStyle}>Model</span>
              <select
                value={model}
                onChange={(event) => handleModelChange(event.target.value)}
                style={fieldStyle}
                disabled={busy}
              >
                {browserModelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={configNoteStyle}>
            Browser demo powered by OpenRouter. For the maintained Node example, use the repo example.
          </div>

          <div style={dockHintStyle}>
            <span style={dockHintDotStyle} />
            <span>{getDockHint({ runtime, runtimeError, hasApiKey, busy })}</span>
          </div>

          <div style={composerStyle}>
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask the agent to inspect logs, fetch data, search docs, or write a report..."
              disabled={!runtime || busy}
              rows={1}
              style={textareaStyle}
            />

            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!canSend}
              style={sendButtonStyle}
            >
              {getSendButtonLabel({ hasApiKey, hasInput: input.trim().length > 0, busy })}
            </button>

            <button type="button" onClick={handleClear} disabled={busy} style={clearButtonStyle}>
              Clear
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

function renderMessage(message: UIMessage): React.ReactNode {
  switch (message.kind) {
    case 'user':
      return (
        <div style={userBubbleShellStyle}>
          <div style={userBubbleStyle}>
            <div style={bubbleLabelStyle}>You</div>
            <div style={messageTextStyle}>{message.text}</div>
          </div>
        </div>
      );
    case 'assistant':
      return (
        <div style={assistantBlockStyle}>
          <div style={assistantLabelStyle}>
            <span style={assistantDotStyle} />
            Agent
          </div>
          <div style={messageTextStyle}>{renderMarkdown(message.text)}</div>
        </div>
      );
    case 'tool-call':
      return (
        <div style={toolShellStyle}>
          <div style={toolHeaderStyle}>
            <div style={trafficLightsStyle}>
              <span style={{ ...trafficDotStyle, background: '#f76c6c' }} />
              <span style={{ ...trafficDotStyle, background: '#f0c761' }} />
              <span style={{ ...trafficDotStyle, background: '#4ae68a' }} />
            </div>
            <span style={toolHeaderLabelStyle}>tool call</span>
          </div>
          <div style={toolCommandShellStyle}>
            <div style={toolCommandLabelStyle}>Command</div>
            <code style={toolCommandStyle}>{renderCommandTokens(message.command)}</code>
          </div>
          <pre style={toolOutputStyle}>
            <AnimatedToolOutput text={message.result || '(no output)'} />
          </pre>
        </div>
      );
    case 'error':
      return (
        <div style={errorCardStyle}>
          <div style={errorLabelStyle}>Error</div>
          <div style={messageTextStyle}>{message.text}</div>
        </div>
      );
  }
}

function renderActiveToolCall(activeToolCall: ActiveToolCall): React.ReactNode {
  return (
    <div style={toolShellStyle}>
      <div style={toolHeaderStyle}>
        <div style={trafficLightsStyle}>
          <span style={{ ...trafficDotStyle, background: '#f76c6c' }} />
          <span style={{ ...trafficDotStyle, background: '#f0c761' }} />
          <span style={{ ...trafficDotStyle, background: '#4ae68a' }} />
        </div>
        <span style={toolHeaderLabelStyle}>tool call</span>
        <span style={toolRunningBadgeStyle}>running</span>
      </div>
      <div style={toolCommandShellStyle}>
        <div style={toolCommandLabelStyle}>Command</div>
        <code style={toolCommandStyle}>{renderCommandTokens(activeToolCall.command)}</code>
      </div>
      <div style={toolProgressBodyStyle}>
        <span style={thinkingDotStyle} />
        <span style={toolProgressTextStyle}>Executing command and waiting for output…</span>
        <span style={thinkingCursorStyle} />
      </div>
    </div>
  );
}

function getSendButtonLabel({
  hasApiKey,
  hasInput,
  busy,
}: {
  hasApiKey: boolean;
  hasInput: boolean;
  busy: boolean;
}): string {
  if (busy) {
    return 'Running…';
  }
  if (!hasApiKey) {
    return 'Add API key';
  }
  if (!hasInput) {
    return 'Enter task';
  }
  return 'Send';
}

function getDockHint({
  runtime,
  runtimeError,
  hasApiKey,
  busy,
}: {
  runtime: AgentCLI | null;
  runtimeError: string;
  hasApiKey: boolean;
  busy: boolean;
}): string {
  if (runtimeError) {
    return 'Runtime failed to initialize. Refresh the page or reload the example.';
  }
  if (!runtime) {
    return 'Preparing the demo workspace…';
  }
  if (!hasApiKey) {
    return 'Add an OpenRouter API key to start.';
  }
  if (busy) {
    return 'Running commands in the demo workspace.';
  }
  return 'Ready. Try a log, fetch, or search task.';
}

function renderMarkdown(markdown: string): React.ReactNode {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p style={markdownParagraphStyle}>{children}</p>,
        ul: ({ children }) => <ul style={markdownListStyle}>{children}</ul>,
        ol: ({ children }) => <ol style={markdownListStyle}>{children}</ol>,
        li: ({ children }) => <li style={markdownListItemStyle}>{children}</li>,
        strong: ({ children }) => <strong style={{ color: 'var(--text-bright)' }}>{children}</strong>,
        em: ({ children }) => <em style={{ color: 'var(--text-bright)' }}>{children}</em>,
        code: ({ children }) => <code style={markdownInlineCodeStyle}>{children}</code>,
        pre: ({ children }) => <pre style={markdownCodeBlockStyle}>{children}</pre>,
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer" style={markdownLinkStyle}>
            {children}
          </a>
        ),
        blockquote: ({ children }) => <blockquote style={markdownQuoteStyle}>{children}</blockquote>,
      }}
    >
      {markdown}
    </ReactMarkdown>
  );
}

function renderCommandTokens(command: string): React.ReactNode {
  return tokenizeCommand(command).map((token, index) => (
    <span key={`${token.kind}-${index}`} style={getCommandTokenStyle(token.kind)}>
      {token.text}
    </span>
  ));
}

function getCommandTokenStyle(kind: CommandTokenKind): React.CSSProperties {
  switch (kind) {
    case 'command':
      return commandNameStyle;
    case 'operator':
      return commandOperatorStyle;
    case 'flag':
      return commandFlagStyle;
    case 'path':
      return commandPathStyle;
    case 'string':
      return commandStringStyle;
    case 'argument':
      return commandArgumentStyle;
  }
}

function AnimatedToolOutput({ text }: { text: string }) {
  const [visibleLength, setVisibleLength] = useState(0);

  useEffect(() => {
    const chunkSize = Math.max(12, Math.ceil(text.length / 24));
    const intervalMs = 12;
    setVisibleLength(0);

    const timer = window.setInterval(() => {
      setVisibleLength((current) => {
        if (current >= text.length) {
          window.clearInterval(timer);
          return current;
        }

        const next = Math.min(text.length, current + chunkSize);
        if (next >= text.length) {
          window.clearInterval(timer);
        }
        return next;
      });
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [text]);

  const visibleText = text.slice(0, visibleLength);
  const complete = visibleLength >= text.length;

  return (
    <>
      {visibleText}
      {!complete ? <span style={animatedCursorStyle} /> : null}
    </>
  );
}

const containerStyle: React.CSSProperties = {
  maxWidth: '1120px',
  margin: '0 auto',
  padding: '1.25rem 1.5rem 1rem',
  width: '100%',
  height: '100%',
  minHeight: 0,
  display: 'grid',
  gridTemplateRows: 'auto 1fr auto',
  gap: '0.9rem',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: '1.25rem',
  flexWrap: 'wrap',
};

const headerLeftStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '0.45rem',
  minWidth: 0,
};

const headerMetaStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.65rem',
  flexWrap: 'wrap',
};

const backLinkStyle: React.CSSProperties = {
  fontSize: '0.82rem',
  color: 'var(--text-muted)',
};

const experimentalBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.18rem 0.55rem',
  borderRadius: '999px',
  border: '1px solid rgba(240, 199, 97, 0.22)',
  background: 'var(--yellow-dim)',
  color: 'var(--yellow)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.68rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const titleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '1.18rem',
  color: 'var(--text-bright)',
  lineHeight: 1.25,
  margin: 0,
};

const sourceLinkStyle: React.CSSProperties = {
  fontSize: '0.76rem',
  color: 'var(--text-muted)',
  whiteSpace: 'nowrap',
  paddingTop: '0.2rem',
};

const headerSubtitleStyle: React.CSSProperties = {
  maxWidth: '720px',
  margin: 0,
  color: 'var(--text-muted)',
  fontSize: '0.86rem',
  lineHeight: 1.6,
};

const headerInlineCodeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.84em',
  color: 'var(--text-bright)',
};

const chatShellStyle: React.CSSProperties = {
  minHeight: 0,
  overflow: 'hidden',
  padding: '1rem 1rem 1.2rem',
  borderRadius: '14px',
  border: '1px solid var(--border)',
  background: 'linear-gradient(180deg, rgba(18, 22, 30, 0.96), rgba(10, 14, 20, 0.98))',
  boxShadow: '0 20px 40px rgba(0, 0, 0, 0.2)',
};

const runtimeErrorStyle: React.CSSProperties = {
  marginBottom: '1rem',
  padding: '0.9rem 1rem',
  borderLeft: '3px solid var(--red)',
  borderRadius: '8px',
  background: 'var(--red-dim)',
};

const chatViewportStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '920px',
  margin: '0 auto',
  height: '100%',
  minHeight: 0,
  overflow: 'auto',
};

const emptyStateStyle: React.CSSProperties = {
  minHeight: '100%',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-start',
  alignItems: 'stretch',
  padding: '1.15rem 0 0.25rem',
};

const emptyHeroStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  textAlign: 'left',
  marginBottom: '0.9rem',
};

const cursorHeroStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '1.45rem',
  fontWeight: 700,
  letterSpacing: '-0.05em',
  marginBottom: '0.4rem',
  animation: 'fadeIn 0.3s both',
};

const emptyTitleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '1.12rem',
  color: 'var(--text-bright)',
  marginBottom: '0.35rem',
  marginTop: 0,
};

const emptySubtitleStyle: React.CSSProperties = {
  maxWidth: '680px',
  color: 'var(--text-muted)',
  fontSize: '0.82rem',
  lineHeight: 1.6,
  margin: 0,
};

const promptGridStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '760px',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
  gap: '0.55rem',
};

const promptCardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.32rem',
  textAlign: 'left',
  padding: '0.7rem 0.8rem',
  borderRadius: '8px',
  border: '1px solid var(--border)',
  borderLeft: '2px solid var(--accent)',
  background: 'var(--bg-elevated)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.75rem',
  lineHeight: 1.45,
  transition: 'all var(--transition)',
};

const promptCardLabelStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '0.64rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const promptCardTextStyle: React.CSSProperties = {
  color: 'var(--text)',
  textWrap: 'pretty',
};

const messageListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.8rem',
  width: '100%',
};

const userBubbleShellStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
};

const userBubbleStyle: React.CSSProperties = {
  maxWidth: '68%',
  padding: '0.8rem 0.95rem',
  borderRadius: '16px 16px 6px 16px',
  background: 'rgba(110, 180, 255, 0.08)',
  border: '1px solid rgba(110, 180, 255, 0.18)',
  boxShadow: '0 10px 24px rgba(0, 0, 0, 0.12)',
};

const bubbleLabelStyle: React.CSSProperties = {
  marginBottom: '0.3rem',
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.68rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const assistantBlockStyle: React.CSSProperties = {
  padding: '0.85rem 0.95rem',
  border: '1px solid var(--border-subtle)',
  borderRadius: '12px',
  background: 'rgba(255, 255, 255, 0.02)',
};

const assistantLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.45rem',
  marginBottom: '0.4rem',
  color: 'var(--green)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.72rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const assistantDotStyle: React.CSSProperties = {
  width: '7px',
  height: '7px',
  borderRadius: '999px',
  background: 'var(--green)',
  boxShadow: '0 0 0 4px rgba(74, 230, 138, 0.08)',
};

const toolShellStyle: React.CSSProperties = {
  marginLeft: '0.55rem',
  borderRadius: '12px',
  border: '1px solid var(--border)',
  overflow: 'hidden',
  background: '#0b1016',
  boxShadow: '0 12px 28px rgba(0, 0, 0, 0.16)',
};

const toolHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  padding: '0.5rem 0.7rem',
  borderBottom: '1px solid var(--border-subtle)',
  background: 'rgba(23, 28, 38, 0.88)',
};

const toolHeaderLabelStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.68rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const trafficLightsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.32rem',
  flexShrink: 0,
};

const trafficDotStyle: React.CSSProperties = {
  width: '9px',
  height: '9px',
  borderRadius: '999px',
};

const toolCommandStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.84rem',
  background: 'transparent',
  border: 'none',
  padding: 0,
  color: 'var(--text-bright)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  lineHeight: 1.65,
};

const toolOutputStyle: React.CSSProperties = {
  margin: 0,
  padding: '0.85rem',
  maxHeight: '200px',
  overflow: 'auto',
  background: '#06090f',
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.78rem',
  lineHeight: 1.65,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const toolCommandShellStyle: React.CSSProperties = {
  padding: '0.7rem 0.8rem 0.62rem',
  borderBottom: '1px solid var(--border-subtle)',
  background: 'rgba(11, 16, 22, 0.92)',
};

const toolCommandLabelStyle: React.CSSProperties = {
  marginBottom: '0.35rem',
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.68rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const toolRunningBadgeStyle: React.CSSProperties = {
  marginLeft: 'auto',
  padding: '0.12rem 0.45rem',
  borderRadius: '999px',
  background: 'var(--accent-dim)',
  color: 'var(--accent)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.66rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const toolProgressBodyStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.55rem',
  padding: '0.85rem',
  background: '#06090f',
  color: 'var(--text-muted)',
};

const toolProgressTextStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.78rem',
  letterSpacing: '0.01em',
};

const errorCardStyle: React.CSSProperties = {
  padding: '0.9rem 1rem',
  borderLeft: '3px solid var(--red)',
  borderRadius: '8px',
  background: 'var(--red-dim)',
};

const errorLabelStyle: React.CSSProperties = {
  marginBottom: '0.35rem',
  color: 'var(--red)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.72rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontWeight: 600,
};

const messageTextStyle: React.CSSProperties = {
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
};

const markdownParagraphStyle: React.CSSProperties = {
  margin: '0 0 0.65rem',
};

const markdownListStyle: React.CSSProperties = {
  margin: '0 0 0.65rem 1.1rem',
  padding: 0,
};

const markdownListItemStyle: React.CSSProperties = {
  marginBottom: '0.25rem',
};

const markdownInlineCodeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.82em',
  background: 'rgba(255, 255, 255, 0.04)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '4px',
  padding: '0.08rem 0.32rem',
};

const markdownCodeBlockStyle: React.CSSProperties = {
  margin: '0 0 0.8rem',
  padding: '0.8rem 0.9rem',
  background: '#0b1016',
  border: '1px solid var(--border-subtle)',
  borderRadius: '8px',
  overflowX: 'auto',
};

const markdownCodeBlockCodeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.8rem',
  background: 'transparent',
  border: 'none',
  padding: 0,
};

const animatedCursorStyle: React.CSSProperties = {
  display: 'inline-block',
  width: '0.45rem',
  height: '0.95em',
  marginLeft: '0.1rem',
  verticalAlign: 'text-bottom',
  background: 'var(--accent)',
  animation: 'blink 0.9s step-end infinite',
};

const markdownLinkStyle: React.CSSProperties = {
  color: 'var(--accent)',
  textDecoration: 'underline',
};

const markdownQuoteStyle: React.CSSProperties = {
  margin: '0 0 0.8rem',
  paddingLeft: '0.8rem',
  borderLeft: '3px solid var(--border)',
  color: 'var(--text-muted)',
};

const thinkingStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.55rem',
  paddingTop: '0.4rem',
  animation: 'fadeIn 0.3s both',
};

const thinkingDotStyle: React.CSSProperties = {
  width: '6px',
  height: '6px',
  borderRadius: '999px',
  background: 'var(--green)',
  animation: 'pulse 1.5s ease-in-out infinite',
};

const thinkingTextStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};

const thinkingCursorStyle: React.CSSProperties = {
  width: '3px',
  height: '1rem',
  background: 'var(--accent)',
  animation: 'blink 1s step-end infinite',
};

const inputDockStyle: React.CSSProperties = {
  borderTop: '1px solid var(--border)',
  paddingTop: '0.7rem',
};

const inputDockInnerStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '920px',
  margin: '0 auto',
  display: 'flex',
  flexDirection: 'column',
  gap: '0.55rem',
};

const configRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(210px, 250px) minmax(210px, 270px)',
  gap: '0.65rem',
  justifyContent: 'start',
};

const configNoteStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '0.78rem',
  lineHeight: 1.5,
};

const configFieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.3rem',
};

const configLabelRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.45rem',
};

const configLabelStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.68rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const requiredBadgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.08rem 0.35rem',
  borderRadius: '999px',
  background: 'rgba(110, 180, 255, 0.12)',
  color: 'var(--accent)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.62rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const fieldStyle: React.CSSProperties = {
  width: '100%',
  height: '40px',
  padding: '0.5rem 0.65rem',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.8rem',
};

const dockHintStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  minHeight: '1.1rem',
  color: 'var(--text-muted)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.72rem',
  lineHeight: 1.5,
};

const dockHintDotStyle: React.CSSProperties = {
  width: '6px',
  height: '6px',
  borderRadius: '999px',
  background: 'var(--accent)',
  flexShrink: 0,
};

const composerStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto auto',
  gap: '0.6rem',
  alignItems: 'stretch',
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '46px',
  resize: 'vertical',
  padding: '0.72rem 0.82rem',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: '10px',
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.84rem',
  lineHeight: 1.5,
};

const sendButtonStyle: React.CSSProperties = {
  alignSelf: 'stretch',
  minWidth: '92px',
  padding: '0 0.95rem',
  borderRadius: '10px',
  border: '1px solid transparent',
  background: 'var(--accent)',
  color: '#0a0e14',
  fontWeight: 700,
  cursor: 'pointer',
};

const clearButtonStyle: React.CSSProperties = {
  alignSelf: 'stretch',
  minWidth: '82px',
  padding: '0 0.9rem',
  borderRadius: '10px',
  border: '1px solid var(--border)',
  background: 'var(--bg-surface)',
  color: 'var(--text-muted)',
  cursor: 'pointer',
};

const commandNameStyle: React.CSSProperties = {
  color: 'var(--accent)',
  fontWeight: 600,
};

const commandOperatorStyle: React.CSSProperties = {
  color: 'var(--yellow)',
};

const commandFlagStyle: React.CSSProperties = {
  color: 'var(--purple)',
};

const commandPathStyle: React.CSSProperties = {
  color: '#8dd0ff',
};

const commandStringStyle: React.CSSProperties = {
  color: 'var(--green)',
};

const commandArgumentStyle: React.CSSProperties = {
  color: 'var(--text-bright)',
};
