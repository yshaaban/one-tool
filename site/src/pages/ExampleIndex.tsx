import { Link } from 'react-router-dom';
import { examples } from '../examples';

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
  const interactive = examples.filter((e) => e.browserRunnable && !e.requiresApiKey);
  const advanced = examples.filter((e) => !e.browserRunnable || e.requiresApiKey);

  return (
    <div style={containerStyle}>
      <div style={headerStyle}>
        <h1 style={titleStyle}>Examples</h1>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.92rem', maxWidth: '500px' }}>
          Interactive walkthroughs that run entirely in your browser. Each example auto-plays its steps in a live
          terminal.
        </p>
      </div>

      {/* Interactive examples */}
      <div style={gridStyle}>
        {interactive.map((ex, i) => {
          const colors = getColors(ex.id);
          const firstCommand = ex.steps?.[0]?.command;
          return (
            <Link
              key={ex.id}
              to={`/examples/${ex.id}`}
              style={{
                ...cardStyle,
                animation: `fadeInUp 0.4s ${i * 0.06}s both`,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = colors.accent;
                e.currentTarget.style.background = 'var(--bg-elevated)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-subtle)';
                e.currentTarget.style.background = 'var(--bg-surface)';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.6rem' }}>
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
                  {ex.id.slice(0, 2)}
                </span>
                <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-bright)' }}>{ex.title}</span>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.84rem', lineHeight: 1.55, marginBottom: '0.75rem' }}>
                {ex.description}
              </p>
              {firstCommand && (
                <div style={commandPreviewStyle}>
                  <span style={{ color: 'var(--accent)', marginRight: '0.4rem' }}>$</span>
                  {firstCommand}
                </div>
              )}
            </Link>
          );
        })}
      </div>

      {/* Advanced / non-interactive */}
      {advanced.length > 0 && (
        <>
          <div style={{ margin: '2.5rem 0 1.25rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--text-bright)' }}>Advanced</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.84rem', marginTop: '0.25rem' }}>
              These examples require Node.js or an API key.
            </p>
          </div>
          <div style={gridStyle}>
            {advanced.map((ex, i) => {
              const colors = getColors(ex.id);
              return (
                <Link
                  key={ex.id}
                  to={`/examples/${ex.id}`}
                  style={{
                    ...cardStyle,
                    animation: `fadeInUp 0.4s ${(interactive.length + i) * 0.06}s both`,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = colors.accent;
                    e.currentTarget.style.background = 'var(--bg-elevated)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border-subtle)';
                    e.currentTarget.style.background = 'var(--bg-surface)';
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.6rem' }}>
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
                      {ex.id.slice(0, 2)}
                    </span>
                    <span style={{ fontWeight: 600, fontSize: '0.95rem', color: 'var(--text-bright)' }}>
                      {ex.title}
                    </span>
                    {!ex.browserRunnable && <span style={badgeStyle}>Node.js</span>}
                    {ex.requiresApiKey && <span style={{ ...badgeStyle, borderColor: 'rgba(240, 199, 97, 0.25)', color: 'var(--yellow)' }}>API Key</span>}
                  </div>
                  <p
                    style={{
                      color: 'var(--text-muted)',
                      fontSize: '0.84rem',
                      lineHeight: 1.55,
                    }}
                  >
                    {ex.description}
                  </p>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const containerStyle: React.CSSProperties = {
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
