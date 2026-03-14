import type { CSSProperties, ReactNode } from 'react';

type CoverageVariant = 'card' | 'page';

interface CoverageChipsProps {
  items?: string[];
  maxItems?: number;
  variant?: CoverageVariant;
}

const rowStyles: Record<CoverageVariant, CSSProperties> = {
  card: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.4rem',
    marginBottom: '0.75rem',
  },
  page: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '0.45rem',
    marginTop: '0.75rem',
  },
};

const chipStyles: Record<CoverageVariant, CSSProperties> = {
  card: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.72rem',
    color: 'var(--text-muted)',
    background: 'var(--bg)',
    border: '1px solid var(--border-subtle)',
    borderRadius: '999px',
    padding: '0.2rem 0.5rem',
  },
  page: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.72rem',
    color: 'var(--text-muted)',
    background: 'var(--bg-surface)',
    border: '1px solid var(--border-subtle)',
    borderRadius: '999px',
    padding: '0.2rem 0.55rem',
  },
};

export function CoverageChips({ items, maxItems, variant = 'page' }: CoverageChipsProps): ReactNode {
  if (!items || items.length === 0) {
    return null;
  }

  const visibleItems = maxItems === undefined ? items : items.slice(0, maxItems);
  if (visibleItems.length === 0) {
    return null;
  }

  return (
    <div style={rowStyles[variant]}>
      {visibleItems.map((entry) => (
        <span key={entry} style={chipStyles[variant]}>
          {entry}
        </span>
      ))}
    </div>
  );
}
