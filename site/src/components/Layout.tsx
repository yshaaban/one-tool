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
            <span style={{ color: 'var(--accent)', fontWeight: 700 }}>$</span>
            <span style={{ marginLeft: '0.35rem' }}>one-tool</span>
          </Link>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            {navItems.map((item) => {
              const active = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  style={{
                    ...navLinkStyle,
                    color: active ? 'var(--text-bright)' : 'var(--text-muted)',
                    background: active ? 'var(--accent-dim)' : 'transparent',
                    borderColor: active ? 'var(--border)' : 'transparent',
                  }}
                >
                  {item.label}
                </Link>
              );
            })}
            <span style={navDivider} />
            <a
              href="https://github.com/yshaaban/one-tool"
              target="_blank"
              rel="noopener noreferrer"
              style={navLinkStyle}
            >
              GitHub
            </a>
          </div>
        </div>
      </nav>
      <main style={{ flex: 1 }}>{children}</main>
      <footer style={footerStyle}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
          one-tool &middot; stateful CLI for LLM agents
        </span>
      </footer>
    </div>
  );
}

const navStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--border-subtle)',
  padding: '0 1.5rem',
  background: 'rgba(10, 14, 20, 0.85)',
  backdropFilter: 'blur(12px)',
  position: 'sticky',
  top: 0,
  zIndex: 100,
};

const navInnerStyle: React.CSSProperties = {
  maxWidth: 'var(--max-width)',
  margin: '0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: '3.25rem',
};

const logoStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontWeight: 600,
  fontSize: '1rem',
  color: 'var(--text-bright)',
  textDecoration: 'none',
  letterSpacing: '-0.01em',
};

const navLinkStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  textDecoration: 'none',
  fontSize: '0.82rem',
  fontWeight: 500,
  padding: '0.3rem 0.7rem',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid transparent',
  transition: 'all var(--transition)',
};

const navDivider: React.CSSProperties = {
  width: '1px',
  height: '1rem',
  background: 'var(--border)',
  margin: '0 0.35rem',
};

const footerStyle: React.CSSProperties = {
  borderTop: '1px solid var(--border-subtle)',
  padding: '1.25rem 1.5rem',
  textAlign: 'center',
};
