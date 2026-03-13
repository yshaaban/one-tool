import { Link } from 'react-router-dom';
import { examples } from '../examples';
import type { ExampleDef } from '../examples/types';

const CATEGORY_COLORS: Record<string, { accent: string; dim: string }> = {
  '01': { accent: 'var(--accent)', dim: 'var(--accent-dim)' },
  '02': { accent: 'var(--yellow)', dim: 'var(--yellow-dim)' },
  '03': { accent: 'var(--red)', dim: 'var(--red-dim)' },
  '04': { accent: 'var(--green)', dim: 'var(--green-dim)' },
  '05': { accent: 'var(--purple)', dim: 'var(--purple-dim)' },
  '06': { accent: 'var(--accent)', dim: 'var(--accent-dim)' },
  '07': { accent: 'var(--yellow)', dim: 'var(--yellow-dim)' },
  '08': { accent: 'var(--green)', dim: 'var(--green-dim)' },
};

function getColors(id: string) {
  return CATEGORY_COLORS[id.slice(0, 2)] ?? { accent: 'var(--accent)', dim: 'var(--accent-dim)' };
}

export function ExampleIndex() {
  const cliCapabilities = examples.filter((example) => example.group === 'cli-capabilities');
  const agentWorkflows = examples.filter((example) => example.group === 'agent-workflows');

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>Examples</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', maxWidth: '500px' }}>
          Start with CLI capabilities to understand the runtime. Move to agent workflows to see why one tool
          works well for agents.
        </p>
      </div>

      <ExampleSection
        title="CLI capabilities"
        description="Learn the runtime itself: commands, traces, persistence, and custom command composition."
        examples={cliCapabilities}
      />

      <ExampleSection
        title="Agent workflows"
        description="See how the same runtime becomes useful for real agent loops, retrieval, safety presets, MCP, and live tool use."
        examples={agentWorkflows}
        topMargin="2.5rem"
      />
    </div>
  );
}

function ExampleSection({
  title,
  description,
  examples,
  topMargin,
}: {
  title: string;
  description: string;
  examples: ExampleDef[];
  topMargin?: string;
}) {
  return (
    <section style={{ marginTop: topMargin ?? '0' }}>
      <div style={{ marginBottom: '1.25rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-bright)' }}>{title}</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.84rem', marginTop: '0.25rem' }}>{description}</p>
      </div>
      <div style={gridStyle}>
        {examples.map((example, index) => (
          <ExampleCard key={example.id} example={example} animationDelay={index * 0.06} />
        ))}
      </div>
    </section>
  );
}

function ExampleCard({ example, animationDelay }: { example: ExampleDef; animationDelay: number }) {
  const colors = getColors(example.id);
  const firstCommand = example.steps?.[0]?.command;

  return (
    <Link
      to={`/examples/${example.id}`}
      style={{
        ...cardStyle,
        animation: `fadeInUp 0.4s ${animationDelay}s both`,
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.borderColor = colors.accent;
        event.currentTarget.style.background = 'var(--bg-elevated)';
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.borderColor = 'var(--border-subtle)';
        event.currentTarget.style.background = 'var(--bg-surface)';
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.75rem',
          marginBottom: '0.6rem',
        }}
      >
        <span
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.72rem',
            fontWeight: 600,
            color: colors.accent,
            background: colors.dim,
            padding: '0.2rem 0.5rem',
            borderRadius: '4px',
            flexShrink: 0,
          }}
        >
          {example.id.slice(0, 2)}
        </span>
        <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-bright)' }}>
          {example.title}
        </span>
        {!example.browserRunnable && <span style={badgeStyle}>Node.js</span>}
        {example.requiresApiKey && (
          <span
            style={{
              ...badgeStyle,
              borderColor: 'rgba(240, 199, 97, 0.25)',
              color: 'var(--yellow)',
            }}
          >
            API Key
          </span>
        )}
      </div>
      <p
        style={{
          color: 'var(--text-muted)',
          fontSize: '0.84rem',
          lineHeight: 1.55,
          marginBottom: firstCommand ? '0.75rem' : 0,
        }}
      >
        {example.description}
      </p>
      {firstCommand && (
        <div style={commandPreviewStyle}>
          <span style={{ color: 'var(--accent)', marginRight: '0.4rem' }}>$</span>
          {firstCommand}
        </div>
      )}
    </Link>
  );
}

const containerStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 0,
  overflow: 'auto',
  maxWidth: 'var(--max-width)',
  margin: '0 auto',
  padding: '2.5rem 1.5rem 3rem',
};

const headerStyle: React.CSSProperties = {
  marginBottom: '2rem',
};

const titleStyle: React.CSSProperties = {
  fontSize: '1.5rem',
  fontFamily: 'var(--font-mono)',
  fontWeight: 700,
  color: 'var(--text-bright)',
  marginBottom: '0.5rem',
  letterSpacing: '-0.02em',
};

const gridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
  gap: '0.85rem',
};

const cardStyle: React.CSSProperties = {
  display: 'block',
  padding: '1.25rem',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius)',
  textDecoration: 'none',
  color: 'var(--text)',
  transition: 'all var(--transition)',
};

const commandPreviewStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.78rem',
  color: 'var(--text-muted)',
  background: 'var(--bg-elevated)',
  padding: '0.4rem 0.65rem',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-subtle)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const badgeStyle: React.CSSProperties = {
  fontSize: '0.65rem',
  fontWeight: 500,
  padding: '0.12rem 0.45rem',
  borderRadius: '4px',
  border: '1px solid var(--border)',
  color: 'var(--text-muted)',
  marginLeft: 'auto',
  flexShrink: 0,
  fontFamily: 'var(--font-mono)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};
