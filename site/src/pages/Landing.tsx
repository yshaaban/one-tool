import { Link } from 'react-router-dom';

const features = [
  {
    title: 'One Tool, Full CLI',
    description:
      'Expose a single run(command) tool to your LLM agent. 25 built-in commands with pipes, &&, ||, and ; composition.',
  },
  {
    title: 'Virtual File System',
    description:
      'Rooted VFS with three backends: MemoryVFS (ephemeral), BrowserVFS (IndexedDB), NodeVFS (disk). No sandbox needed.',
  },
  {
    title: 'Search & Fetch Adapters',
    description:
      'Plug in your own search and fetch backends. The agent uses them like CLI commands: search query | write /report.txt',
  },
  {
    title: 'Browser-Ready',
    description:
      'The entire runtime works in the browser. Try it right now in the playground — no install required.',
  },
];

export function Landing() {
  return (
    <div style={{ maxWidth: 'var(--max-width)', margin: '0 auto', padding: '3rem 1.5rem' }}>
      <section style={{ textAlign: 'center', marginBottom: '4rem' }}>
        <h1 style={{ fontSize: '2.5rem', fontFamily: 'var(--font-mono)', marginBottom: '1rem' }}>one-tool</h1>
        <p
          style={{
            fontSize: '1.25rem',
            color: 'var(--text-muted)',
            maxWidth: '600px',
            margin: '0 auto 2rem',
          }}
        >
          Stateful CLI environment for LLM agents. One tool replaces a catalog of typed tools.
        </p>
        <div style={{ display: 'flex', gap: '1rem', justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/playground" style={ctaStyle}>
            Try the Playground
          </Link>
          <Link to="/examples" style={secondaryCtaStyle}>
            View Examples
          </Link>
        </div>
      </section>

      <section style={{ marginBottom: '4rem' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '1.5rem',
          }}
        >
          {features.map((f) => (
            <div key={f.title} style={cardStyle}>
              <h3 style={{ fontSize: '1.1rem', marginBottom: '0.5rem' }}>{f.title}</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.6 }}>
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section style={{ textAlign: 'center' }}>
        <h2 style={{ fontSize: '1.3rem', marginBottom: '1rem' }}>Quick Example</h2>
        <pre style={codeBlockStyle}>
          {`import { createAgentCLI, MemoryVFS } from 'one-tool/browser';

const runtime = await createAgentCLI({ vfs: new MemoryVFS() });

await runtime.run('write /hello.txt "Hello from one-tool"');
await runtime.run('cat /hello.txt');
// → Hello from one-tool

await runtime.run('ls /');
// → /hello.txt

await runtime.run('help');
// → Available commands: ...`}
        </pre>
      </section>
    </div>
  );
}

const ctaStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '0.75rem 1.5rem',
  background: 'var(--accent)',
  color: '#fff',
  borderRadius: '6px',
  fontWeight: 600,
  fontSize: '1rem',
  textDecoration: 'none',
};

const secondaryCtaStyle: React.CSSProperties = {
  ...ctaStyle,
  background: 'transparent',
  border: '1px solid var(--border)',
  color: 'var(--text)',
};

const cardStyle: React.CSSProperties = {
  padding: '1.5rem',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
};

const codeBlockStyle: React.CSSProperties = {
  textAlign: 'left',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  padding: '1.5rem',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.85rem',
  lineHeight: 1.6,
  overflowX: 'auto',
  maxWidth: '700px',
  margin: '0 auto',
};
