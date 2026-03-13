import { Link } from 'react-router-dom';

const features = [
  {
    tag: 'runtime',
    title: 'One Tool for AI Agents',
    description:
      'Expose a single run(command) tool. Agents get 26 built-in commands with pipes, &&, ||, and ; composition.',
    accent: 'var(--accent)',
    dim: 'var(--accent-dim)',
  },
  {
    tag: 'vfs',
    title: 'Constrained Workspace',
    description:
      'Use MemoryVFS, BrowserVFS, or NodeVFS for rooted storage without a Python or shell sandbox.',
    accent: 'var(--green)',
    dim: 'var(--green-dim)',
  },
  {
    tag: 'adapters',
    title: 'Search & Fetch',
    description:
      'Plug in your own backends. Agents compose retrieval, files, and text processing in one tool call.',
    accent: 'var(--yellow)',
    dim: 'var(--yellow-dim)',
  },
  {
    tag: 'browser',
    title: 'Browser-Safe Runtime',
    description:
      'Use the browser entrypoint directly in the playground, in client-side demos, or in middleware-style apps.',
    accent: 'var(--purple)',
    dim: 'var(--purple-dim)',
  },
];

const agentLoopPrinciples = [
  {
    title: 'Discover',
    description:
      'Start with help. Commands describe themselves instead of forcing the model to memorize a tool catalog.',
  },
  {
    title: 'Compose',
    description: 'Keep file, text, JSON, retrieval, and memory work inside one run(command) call.',
  },
  {
    title: 'Recover',
    description:
      'stderr, exit codes, and truncated-output saves give the agent useful feedback for the next step.',
  },
];

const codeLines = [
  { text: 'import { createAgentCLI, MemoryVFS } from ', dim: true },
  { text: "'one-tool/browser'", accent: true },
  { text: ';', dim: true },
  { text: '', blank: true },
  { text: 'const cli = await createAgentCLI({ vfs: new MemoryVFS() });', dim: false },
  { text: '', blank: true },
  { text: 'await cli.run(', dim: false },
  { text: '\'write /hello.txt "Hello"\'', accent: true },
  { text: ');', dim: true },
  { text: 'await cli.run(', dim: false },
  { text: "'cat /hello.txt'", accent: true },
  { text: ');', dim: true },
  { text: '// → Hello', comment: true },
];

export function Landing() {
  return (
    <div>
      {/* Hero */}
      <section style={heroStyle}>
        <div style={heroInnerStyle}>
          <div style={heroBadgeStyle}>
            <span style={{ color: 'var(--green)', marginRight: '0.4rem' }}>{'>'}</span>
            npm i one-tool
          </div>

          <h1 style={heroTitleStyle}>
            One tool.
            <br />
            <span style={{ color: 'var(--accent)' }}>Real agent work.</span>
          </h1>

          <p style={heroSubtitleStyle}>
            A constrained workspace for AI agents. Replace a catalog of narrow tools or a code-interpreter
            sandbox with a single <code style={inlineCodeStyle}>run(command)</code> interface.
          </p>

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/playground" style={primaryCtaStyle}>
              Open Playground
            </Link>
            <Link to="/examples" style={secondaryCtaStyle}>
              Browse Examples
            </Link>
          </div>
        </div>
      </section>

      {/* Features */}
      <section style={sectionStyle}>
        <div style={featuresGridStyle}>
          {features.map((f, i) => (
            <div
              key={f.tag}
              style={{
                ...featureCardStyle,
                animation: `fadeInUp 0.5s ${i * 0.08}s both`,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.7rem',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: f.accent,
                  background: f.dim,
                  padding: '0.2rem 0.55rem',
                  borderRadius: '4px',
                  display: 'inline-block',
                  marginBottom: '0.75rem',
                }}
              >
                {f.tag}
              </span>
              <h3
                style={{
                  fontSize: '1.05rem',
                  fontWeight: 600,
                  marginBottom: '0.5rem',
                  color: 'var(--text-bright)',
                }}
              >
                {f.title}
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', lineHeight: 1.65 }}>
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section style={{ ...sectionStyle, paddingTop: 0 }}>
        <div style={principlesShellStyle}>
          <div style={{ marginBottom: '1rem' }}>
            <h2 style={principlesTitleStyle}>Built for agent feedback loops</h2>
            <p style={principlesSubtitleStyle}>
              one-tool works because models can discover commands, compose them, and use output and errors to
              decide what to do next.
            </p>
          </div>
          <div style={principlesGridStyle}>
            {agentLoopPrinciples.map((principle) => (
              <div key={principle.title} style={principleCardStyle}>
                <h3 style={principleHeadingStyle}>{principle.title}</h3>
                <p style={principleTextStyle}>{principle.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Code example */}
      <section style={{ ...sectionStyle, paddingBottom: '4rem' }}>
        <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-bright)' }}>
            Get started in 4 lines
          </h2>
        </div>
        <div style={codeBlockStyle}>
          <div style={codeHeaderStyle}>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              <span style={dot('#f76c6c')} />
              <span style={dot('#f0c761')} />
              <span style={dot('#4ae68a')} />
            </div>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
              example.ts
            </span>
          </div>
          <pre style={codeContentStyle}>
            {codeLines.map((line, i) => {
              if (line.blank) return <br key={i} />;
              if (line.comment) {
                return (
                  <span key={i} style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>
                    {line.text}
                    {'\n'}
                  </span>
                );
              }
              return (
                <span
                  key={i}
                  style={{
                    color: line.accent ? 'var(--green)' : line.dim ? 'var(--text-muted)' : 'var(--text)',
                  }}
                >
                  {line.text}
                  {line.dim && !line.text.endsWith(';') ? '' : '\n'}
                </span>
              );
            })}
          </pre>
        </div>
      </section>
    </div>
  );
}

const heroStyle: React.CSSProperties = {
  padding: '5rem 1.5rem 3.5rem',
  position: 'relative',
  overflow: 'hidden',
};

const heroInnerStyle: React.CSSProperties = {
  maxWidth: 'var(--max-width)',
  margin: '0 auto',
  textAlign: 'center',
  position: 'relative',
};

const heroBadgeStyle: React.CSSProperties = {
  display: 'inline-block',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.82rem',
  color: 'var(--text-muted)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: '20px',
  padding: '0.35rem 1rem',
  marginBottom: '1.75rem',
  animation: 'fadeInUp 0.5s both',
};

const heroTitleStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'clamp(2rem, 5vw, 3rem)',
  fontWeight: 700,
  lineHeight: 1.15,
  letterSpacing: '-0.03em',
  color: 'var(--text-bright)',
  marginBottom: '1.25rem',
  animation: 'fadeInUp 0.5s 0.1s both',
};

const heroSubtitleStyle: React.CSSProperties = {
  fontSize: '1.1rem',
  color: 'var(--text-muted)',
  maxWidth: '540px',
  margin: '0 auto 2rem',
  lineHeight: 1.6,
  animation: 'fadeInUp 0.5s 0.2s both',
};

const inlineCodeStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.95em',
  color: 'var(--accent)',
  background: 'var(--accent-dim)',
  padding: '0.15em 0.4em',
  borderRadius: '4px',
  border: '1px solid rgba(110, 180, 255, 0.15)',
};

const primaryCtaStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '0.65rem 1.5rem',
  background: 'var(--accent)',
  color: '#0a0e14',
  borderRadius: 'var(--radius)',
  fontWeight: 600,
  fontSize: '0.92rem',
  textDecoration: 'none',
  transition: 'all var(--transition)',
  border: 'none',
};

const secondaryCtaStyle: React.CSSProperties = {
  ...primaryCtaStyle,
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--text)',
};

const sectionStyle: React.CSSProperties = {
  maxWidth: 'var(--max-width)',
  margin: '0 auto',
  padding: '0 1.5rem 3rem',
};

const featuresGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))',
  gap: '1rem',
};

const featureCardStyle: React.CSSProperties = {
  padding: '1.5rem',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius)',
  transition: 'border-color var(--transition), background var(--transition)',
};

const principlesShellStyle: React.CSSProperties = {
  maxWidth: 'var(--max-width)',
  margin: '0 auto',
  padding: '1.25rem',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border-subtle)',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))',
};

const principlesTitleStyle: React.CSSProperties = {
  fontSize: '1.05rem',
  fontWeight: 600,
  color: 'var(--text-bright)',
};

const principlesSubtitleStyle: React.CSSProperties = {
  marginTop: '0.35rem',
  color: 'var(--text-muted)',
  fontSize: '0.9rem',
  lineHeight: 1.6,
};

const principlesGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '0.85rem',
};

const principleCardStyle: React.CSSProperties = {
  padding: '0.95rem',
  borderRadius: 'var(--radius-sm)',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
};

const principleHeadingStyle: React.CSSProperties = {
  fontSize: '0.88rem',
  fontWeight: 600,
  color: 'var(--text-bright)',
  marginBottom: '0.35rem',
  fontFamily: 'var(--font-mono)',
};

const principleTextStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '0.84rem',
  lineHeight: 1.6,
};

const codeBlockStyle: React.CSSProperties = {
  maxWidth: '600px',
  margin: '0 auto',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  overflow: 'hidden',
  background: 'var(--bg-surface)',
};

const codeHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '0.6rem 0.9rem',
  borderBottom: '1px solid var(--border-subtle)',
  background: 'rgba(255, 255, 255, 0.02)',
};

const codeContentStyle: React.CSSProperties = {
  padding: '1.25rem',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.84rem',
  lineHeight: 1.7,
  margin: 0,
  overflowX: 'auto',
};

function dot(color: string): React.CSSProperties {
  return {
    width: '0.65rem',
    height: '0.65rem',
    borderRadius: '999px',
    display: 'inline-block',
    background: color,
    boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.2)',
  };
}
