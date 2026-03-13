import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Home' },
  { to: '/playground', label: 'Playground' },
  { to: '/examples', label: 'Examples' },
];

export function Layout({ children }: { children: ReactNode }) {
  const location = useLocation();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <nav style={navStyle}>
        <div style={navInnerStyle}>
          <Link to="/" style={logoStyle}>
            one-tool
          </Link>
          <div style={{ display: 'flex', gap: '1.5rem' }}>
            {navItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                style={{
                  ...linkStyle,
                  color: location.pathname === item.to ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                {item.label}
              </Link>
            ))}
            <a
              href="https://github.com/yshaaban/one-tool"
              target="_blank"
              rel="noopener noreferrer"
              style={linkStyle}
            >
              GitHub
            </a>
          </div>
        </div>
      </nav>
      <main style={{ flex: 1 }}>{children}</main>
      <footer style={footerStyle}>
        <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
          one-tool &mdash; Stateful CLI environment for LLM agents
        </span>
      </footer>
    </div>
  );
}

const navStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border)',
  padding: '0.75rem 1.5rem',
  background: 'var(--bg-surface)',
};

const navInnerStyle: React.CSSProperties = {
  maxWidth: 'var(--max-width)',
  margin: '0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const logoStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontWeight: 700,
  fontSize: '1.1rem',
  color: 'var(--text)',
  textDecoration: 'none',
};

const linkStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  textDecoration: 'none',
  fontSize: '0.9rem',
};

const footerStyle: React.CSSProperties = {
  borderTop: '1px solid var(--border)',
  padding: '1rem 1.5rem',
  textAlign: 'center',
};
