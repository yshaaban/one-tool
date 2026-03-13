import test from 'node:test';

interface ExampleModule {
  main(options?: { quiet?: boolean; args?: string[] }): Promise<void>;
}

interface ExampleSmokeCase {
  name: string;
  path: string;
  args?: string[];
}

const EXAMPLES: readonly ExampleSmokeCase[] = [
  { name: '01-hello-world', path: '../examples/01-hello-world.js' },
  { name: '02-custom-command', path: '../examples/02-custom-command.js' },
  { name: '03-readonly-agent', path: '../examples/03-readonly-agent.js' },
  { name: '04-detailed-execution', path: '../examples/04-detailed-execution.js' },
  { name: '05-adapters', path: '../examples/05-adapters.js' },
  { name: '06-browser-persistence', path: '../examples/06-browser-persistence.js' },
  { name: '07-mcp-server', path: '../examples/07-mcp-server.js', args: ['--self-test'] },
  { name: '08-llm-agent', path: '../examples/08-llm-agent.js', args: ['--self-test'] },
  { name: 'advanced/command-selection', path: '../examples/advanced/command-selection.js' },
  { name: 'advanced/command-overrides', path: '../examples/advanced/command-overrides.js' },
  { name: 'advanced/extension-helpers', path: '../examples/advanced/extension-helpers.js' },
  { name: 'advanced/overflow-and-binary', path: '../examples/advanced/overflow-and-binary.js' },
  { name: 'advanced/prompt-variants', path: '../examples/advanced/prompt-variants.js' },
  { name: 'advanced/scenario-testing', path: '../examples/advanced/scenario-testing.js' },
  {
    name: 'advanced/testing-custom-commands',
    path: '../examples/advanced/testing-custom-commands.js',
  },
  {
    name: 'advanced/http-tool-endpoint',
    path: '../examples/advanced/http-tool-endpoint.js',
    args: ['--self-test'],
  },
] as const;

for (const entry of EXAMPLES) {
  test(`example smoke: ${entry.name}`, async function (): Promise<void> {
    const module = (await import(new URL(entry.path, import.meta.url).href)) as Partial<ExampleModule>;
    if (typeof module.main !== 'function') {
      throw new Error(`example does not export main(): ${entry.name}`);
    }

    await module.main({
      quiet: true,
      ...(entry.args ? { args: [...entry.args] } : {}),
    });
  });
}
