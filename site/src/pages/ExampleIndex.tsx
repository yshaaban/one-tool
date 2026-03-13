import { Link } from 'react-router-dom';
import { examples } from '../examples';

export function ExampleIndex() {
  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '2rem 1.5rem' }}>
      <h1 style={{ fontSize: '1.5rem', fontFamily: 'var(--font-mono)', marginBottom: '0.5rem' }}>Examples</h1>
      <p style={{ color: 'var(--text-muted)', marginBottom: '2rem', fontSize: '0.9rem' }}>
        Walk through guided examples or explore the source code.
      </p>
      <div
        style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}
      >
        {examples.map((ex) => (
          <Link
            key={ex.id}
            to={`/examples/${ex.id}`}
            style={{
              display: 'block',
              padding: '1.25rem',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              textDecoration: 'none',
              color: 'var(--text)',
              transition: 'border-color 0.15s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem', color: 'var(--accent)' }}>
                {ex.id.slice(0, 2)}
              </span>
              <span style={{ fontWeight: 600 }}>{ex.title}</span>
              {!ex.browserRunnable && <span style={badgeStyle}>Node only</span>}
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.5 }}>
              {ex.description}
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}

const badgeStyle: React.CSSProperties = {
  fontSize: '0.7rem',
  padding: '0.15rem 0.5rem',
  borderRadius: '10px',
  background: 'var(--bg-hover)',
  border: '1px solid var(--border)',
  color: 'var(--text-muted)',
  marginLeft: 'auto',
};
