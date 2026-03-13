import { Link } from 'react-router-dom';

const features = [
  {
    tag: 'tool',
    title: 'Single tool surface',
    description: 'Expose one run(command) tool instead of a catalog of narrow tools.',
    accent: 'var(--accent)',
    dim: 'var(--accent-dim)',
  },
  {
    tag: 'storage',
    title: 'Rooted storage',
    description:
      'Store and inspect files through MemoryVFS, BrowserVFS, or NodeVFS without exposing a shell or Python sandbox.',
    accent: 'var(--green)',
    dim: 'var(--green-dim)',
  },
  {
    tag: 'commands',
    title: 'Composable commands',
    description: 'Compose file, text, retrieval, and memory operations with pipes, &&, ||, and ;.',
    accent: 'var(--yellow)',
    dim: 'var(--yellow-dim)',
  },
  {
    tag: 'deploy',
    title: 'Browser and MCP paths',
    description: 'Use the browser entrypoint for in-browser demos and the MCP server for Claude Code.',
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
  { text: "'@onetool/one-tool/browser'", accent: true },
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
    <div style={pageStyle}>
      {/* Hero */}
      <section style={heroStyle}>
        <div style={heroInnerStyle}>
          <div style={heroBadgeStyle}>
            <span style={{ color: 'var(--green)', marginRight: '0.4rem' }}>{'>'}</span>
            npm i @onetool/one-tool
          </div>

          <h1 style={heroTitleStyle}>A constrained workspace for AI agents</h1>

          <p style={heroSubtitleStyle}>
            Use one <code style={inlineCodeStyle}>run(command)</code> tool to give agents files, text
            processing, retrieval, and memory without exposing a shell or Python sandbox.
          </p>

          <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link to="/playground" style={primaryCtaStyle}>
              Playground
            </Link>
            <Link to="/examples/08-llm-agent" style={secondaryCtaStyle}>
              Agent example
            </Link>
            <Link to="/examples" style={secondaryCtaStyle}>
              Examples
            </Link>
          </div>
        </div>
      </section>

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
        <div style={comparisonShellStyle}>
          <div style={comparisonHeaderStyle}>
            <h2 style={comparisonTitleStyle}>Why teams use it</h2>
            <p style={comparisonSubtitleStyle}>
              It sits between many narrow tools and general-purpose sandboxes.
            </p>
          </div>
          <div style={comparisonGridStyle}>
            <div style={comparisonCardStyle}>
              <h3 style={comparisonCardTitleStyle}>Many narrow tools</h3>
              <p style={comparisonCardTextStyle}>Flexible, but models have to plan across many schemas.</p>
            </div>
            <div style={comparisonCardStyle}>
              <h3 style={comparisonCardTitleStyle}>Python or shell sandbox</h3>
              <p style={comparisonCardTextStyle}>
                More flexible, but harder to constrain and more expensive to operate.
              </p>
            </div>
            <div style={comparisonCardStyle}>
              <h3 style={comparisonCardTitleStyle}>one-tool</h3>
              <p style={comparisonCardTextStyle}>
                Narrower, easier to test, and easier to deploy in browser, server, and MCP workflows.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section style={{ ...sectionStyle, paddingTop: 0 }}>
        <div style={agentHeroStyle}>
          <div>
            <h2 style={agentHeroTitleStyle}>Agent example</h2>
            <p style={agentHeroTextStyle}>
              Follow the agent loop directly: prompt, tool call, tool output, and final answer.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <Link to="/examples/08-llm-agent" style={primaryCtaStyle}>
              Open example
            </Link>
            <Link to="/examples" style={secondaryCtaStyle}>
              All examples
            </Link>
          </div>
        </div>
      </section>

      <section style={{ ...sectionStyle, paddingTop: 0 }}>
        <div style={principlesShellStyle}>
          <div style={{ marginBottom: '1rem' }}>
            <h2 style={principlesTitleStyle}>How agents use it</h2>
            <p style={principlesSubtitleStyle}>
              Agents discover commands, compose them, and use output and errors to choose the next step.
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
          <h2 style={{ fontSize: '1.15rem', fontWeight: 600, color: 'var(--text-bright)' }}>Minimal setup</h2>
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

const pageStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 0,
  overflow: 'auto',
};

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

const comparisonShellStyle: React.CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 'var(--radius)',
  background: 'var(--bg-surface)',
  padding: '1.25rem',
};

const comparisonHeaderStyle: React.CSSProperties = {
  marginBottom: '1rem',
};

const comparisonTitleStyle: React.CSSProperties = {
  fontSize: '1.05rem',
  fontWeight: 600,
  color: 'var(--text-bright)',
};

const comparisonSubtitleStyle: React.CSSProperties = {
  marginTop: '0.35rem',
  color: 'var(--text-muted)',
  fontSize: '0.9rem',
  lineHeight: 1.6,
};

const comparisonGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
  gap: '0.85rem',
};

const comparisonCardStyle: React.CSSProperties = {
  padding: '0.95rem',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-elevated)',
};

const comparisonCardTitleStyle: React.CSSProperties = {
  fontSize: '0.88rem',
  fontWeight: 600,
  color: 'var(--text-bright)',
  marginBottom: '0.35rem',
  fontFamily: 'var(--font-mono)',
};

const comparisonCardTextStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: '0.84rem',
  lineHeight: 1.6,
};

const principlesShellStyle: React.CSSProperties = {
  maxWidth: 'var(--max-width)',
  margin: '0 auto',
  padding: '1.25rem',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border-subtle)',
  background: 'linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))',
};

const agentHeroStyle: React.CSSProperties = {
  maxWidth: 'var(--max-width)',
  margin: '0 auto',
  padding: '1.25rem',
  borderRadius: 'var(--radius)',
  border: '1px solid rgba(110, 180, 255, 0.18)',
  background: 'linear-gradient(180deg, rgba(110, 180, 255, 0.08), rgba(110, 180, 255, 0.03))',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '1rem',
  flexWrap: 'wrap',
};

const agentHeroTitleStyle: React.CSSProperties = {
  fontSize: '1.05rem',
  fontWeight: 600,
  color: 'var(--text-bright)',
};

const agentHeroTextStyle: React.CSSProperties = {
  marginTop: '0.35rem',
  color: 'var(--text-muted)',
  fontSize: '0.9rem',
  lineHeight: 1.6,
  maxWidth: '620px',
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
