import { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { sourceBaseUrl } from '../config';
import { createDemoRuntime } from '../runtime/create-runtime';
import {
  createAgentSession,
  createBrowserConfig,
  getProviderDefaults,
  runAgentTurn,
  type AgentConfig,
  type AgentProvider,
  type AgentSession,
} from '../runtime/browser-agent';
import type { AgentCLI } from 'one-tool/browser';
import type { ExampleDef } from '../examples/types';

// ---------------------------------------------------------------------------
// UI message types
// ---------------------------------------------------------------------------

type UIMessage =
  | { kind: 'user'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool-call'; command: string; result: string }
  | { kind: 'error'; text: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AgentPage({ example }: { example: ExampleDef }) {
  const sourceUrl = new URL(example.sourceFile, sourceBaseUrl).href;

  // Runtime
  const [runtime, setRuntime] = useState<AgentCLI | null>(null);
  const [runtimeError, setRuntimeError] = useState('');

  // Config (in-memory only — never persisted)
  const [provider, setProvider] = useState<AgentProvider>('groq');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [configCollapsed, setConfigCollapsed] = useState(false);

  // Chat state
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef<AgentSession | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Initialize runtime
  useEffect(() => {
    let cancelled = false;
    createDemoRuntime()
      .then((rt) => {
        if (!cancelled) setRuntime(rt);
      })
      .catch((err: unknown) => {
        if (!cancelled) setRuntimeError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Update model placeholder when provider changes
  const defaults = getProviderDefaults(provider);

  const handleSend = useCallback(async () => {
    if (!runtime || !apiKey.trim() || !input.trim() || busy) return;

    const userText = input.trim();
    setInput('');
    setBusy(true);
    setConfigCollapsed(true);

    // Add user message
    setMessages((prev) => [...prev, { kind: 'user', text: userText }]);

    // Create session on first message
    if (!sessionRef.current) {
      sessionRef.current = createAgentSession(runtime);
    }

    const config: AgentConfig = createBrowserConfig(
      provider,
      apiKey.trim(),
      model.trim() || undefined,
      baseUrl.trim() || undefined,
    );

    try {
      const result = await runAgentTurn(runtime, config, userText, sessionRef.current, {
        onToolCall: (command, toolResult) => {
          setMessages((prev) => [...prev, { kind: 'tool-call', command, result: toolResult }]);
        },
      });
      setMessages((prev) => [...prev, { kind: 'assistant', text: result.reply }]);
    } catch (err) {
      const errorText = err instanceof Error ? err.message : String(err);
      setMessages((prev) => [...prev, { kind: 'error', text: errorText }]);
    } finally {
      setBusy(false);
    }
  }, [runtime, apiKey, input, busy, provider, model, baseUrl]);

  const handleClear = useCallback(() => {
    setMessages([]);
    sessionRef.current = null;
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ marginBottom: '1rem' }}>
        <Link to="/examples" style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
          &larr; All examples
        </Link>
        <h1 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-mono)', marginTop: '0.5rem' }}>
          {example.title}
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{example.description}</p>
        <p style={{ fontSize: '0.8rem', marginTop: '0.25rem' }}>
          <a href={sourceUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--text-muted)' }}>
            View source
          </a>
        </p>
      </div>

      {/* Experimental warning */}
      <div style={warningStyle}>
        <strong>Experimental</strong> &mdash; Your API key is sent directly from your browser to the provider&apos;s
        API. This is for development and testing only. Never use production API keys.
      </div>

      {/* Runtime error */}
      {runtimeError && (
        <div style={errorBannerStyle}>
          <strong>Failed to initialize runtime.</strong>
          <div style={{ marginTop: '0.35rem' }}>{runtimeError}</div>
        </div>
      )}

      {/* Config panel */}
      <div style={configPanelStyle}>
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setConfigCollapsed(!configCollapsed)}
        >
          <h3 style={{ fontSize: '0.9rem', color: 'var(--text-muted)', margin: 0 }}>
            Configuration {configCollapsed ? '(click to expand)' : ''}
          </h3>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{configCollapsed ? '+' : '-'}</span>
        </div>

        {!configCollapsed && (
          <div style={{ marginTop: '0.75rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <label style={labelStyle}>
              Provider
              <select
                value={provider}
                onChange={(e) => {
                  setProvider(e.target.value as AgentProvider);
                  setModel('');
                  setBaseUrl('');
                }}
                style={inputStyle}
              >
                <option value="groq">Groq</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic (OpenAI-compatible)</option>
              </select>
            </label>

            <label style={labelStyle}>
              API Key
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-..."
                style={inputStyle}
              />
            </label>

            <label style={labelStyle}>
              Model
              <input
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder={defaults.model}
                style={inputStyle}
              />
            </label>

            <label style={labelStyle}>
              Base URL (optional)
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={defaults.baseUrl}
                style={inputStyle}
              />
            </label>
          </div>
        )}
      </div>

      {/* Chat messages */}
      <div style={chatContainerStyle}>
        {messages.length === 0 && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '2rem' }}>
            Enter your API key above, then ask the agent a question.
            <br />
            The runtime is pre-loaded with demo files, search, and fetch adapters.
            <br />
            <br />
            Try: &quot;What errors are in the logs?&quot; or &quot;Look up order 123 and tell me the
            customer&apos;s email&quot;
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} style={{ marginBottom: '0.75rem' }}>
            {msg.kind === 'user' && (
              <div style={userMsgStyle}>
                <span style={roleLabelStyle}>You</span>
                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
              </div>
            )}
            {msg.kind === 'assistant' && (
              <div style={assistantMsgStyle}>
                <span style={roleLabelStyle}>Agent</span>
                <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
              </div>
            )}
            {msg.kind === 'tool-call' && (
              <div style={toolCallStyle}>
                <div style={toolCallHeaderStyle}>
                  <code style={{ fontSize: '0.8rem' }}>$ {msg.command}</code>
                </div>
                <pre style={toolCallResultStyle}>{msg.result || '(no output)'}</pre>
              </div>
            )}
            {msg.kind === 'error' && (
              <div style={errorMsgStyle}>
                <span style={{ fontWeight: 600 }}>Error</span>
                <div style={{ marginTop: '0.25rem' }}>{msg.text}</div>
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', padding: '0.5rem 0' }}>
            Agent is thinking...
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div style={inputAreaStyle}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask the agent..."
          disabled={!runtime || !apiKey.trim() || busy}
          rows={2}
          style={textareaStyle}
        />
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            onClick={handleSend}
            disabled={!runtime || !apiKey.trim() || !input.trim() || busy}
            style={sendButtonStyle}
          >
            {busy ? 'Running...' : 'Send'}
          </button>
          {messages.length > 0 && (
            <button onClick={handleClear} disabled={busy} style={clearButtonStyle}>
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const containerStyle: React.CSSProperties = {
  maxWidth: 'var(--max-width)',
  margin: '0 auto',
  padding: '1.5rem',
  display: 'flex',
  flexDirection: 'column',
  height: 'calc(100vh - 120px)',
};

const warningStyle: React.CSSProperties = {
  marginBottom: '1rem',
  padding: '0.75rem 1rem',
  background: 'rgba(210, 153, 34, 0.12)',
  border: '1px solid rgba(210, 153, 34, 0.3)',
  borderRadius: '8px',
  color: 'var(--text)',
  fontSize: '0.85rem',
};

const errorBannerStyle: React.CSSProperties = {
  marginBottom: '1rem',
  padding: '0.75rem 1rem',
  background: 'rgba(248, 81, 73, 0.12)',
  border: '1px solid rgba(248, 81, 73, 0.3)',
  borderRadius: '8px',
  color: 'var(--text)',
  fontSize: '0.85rem',
};

const configPanelStyle: React.CSSProperties = {
  marginBottom: '1rem',
  padding: '0.75rem 1rem',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
};

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.25rem',
  fontSize: '0.8rem',
  color: 'var(--text-muted)',
};

const inputStyle: React.CSSProperties = {
  padding: '0.5rem',
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.85rem',
};

const chatContainerStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
  marginBottom: '1rem',
  padding: '0.5rem',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  background: 'var(--bg-surface)',
};

const roleLabelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 600,
  color: 'var(--text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '0.25rem',
  display: 'block',
};

const userMsgStyle: React.CSSProperties = {
  padding: '0.75rem',
  background: 'rgba(88, 166, 255, 0.08)',
  borderRadius: '8px',
  fontSize: '0.9rem',
};

const assistantMsgStyle: React.CSSProperties = {
  padding: '0.75rem',
  borderRadius: '8px',
  fontSize: '0.9rem',
};

const toolCallStyle: React.CSSProperties = {
  marginLeft: '1rem',
  border: '1px solid var(--border)',
  borderRadius: '6px',
  overflow: 'hidden',
};

const toolCallHeaderStyle: React.CSSProperties = {
  padding: '0.4rem 0.75rem',
  background: 'var(--bg-hover)',
  borderBottom: '1px solid var(--border)',
  fontFamily: 'var(--font-mono)',
};

const toolCallResultStyle: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  margin: 0,
  fontSize: '0.8rem',
  fontFamily: 'var(--font-mono)',
  color: 'var(--text-muted)',
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  maxHeight: '200px',
  overflow: 'auto',
};

const errorMsgStyle: React.CSSProperties = {
  padding: '0.75rem',
  background: 'rgba(248, 81, 73, 0.12)',
  border: '1px solid rgba(248, 81, 73, 0.3)',
  borderRadius: '8px',
  fontSize: '0.85rem',
};

const inputAreaStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  alignItems: 'flex-end',
};

const textareaStyle: React.CSSProperties = {
  flex: 1,
  padding: '0.5rem 0.75rem',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  color: 'var(--text)',
  fontFamily: 'var(--font-sans)',
  fontSize: '0.9rem',
  resize: 'none',
  lineHeight: 1.4,
};

const sendButtonStyle: React.CSSProperties = {
  padding: '0.5rem 1.25rem',
  background: 'var(--accent)',
  color: '#fff',
  border: 'none',
  borderRadius: '8px',
  fontWeight: 600,
  fontSize: '0.85rem',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const clearButtonStyle: React.CSSProperties = {
  padding: '0.5rem 1rem',
  background: 'transparent',
  color: 'var(--text-muted)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontSize: '0.85rem',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
