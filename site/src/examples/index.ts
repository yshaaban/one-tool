import type { ExampleDef } from './types';

export const examples: ExampleDef[] = [
  {
    id: '01-hello-world',
    title: 'Hello World',
    description: 'Create a runtime and run your first commands.',
    browserRunnable: true,
    requiresApiKey: false,
    sourceFile: 'examples/01-hello-world.ts',
    runtimeKind: 'empty',
    autoPlay: true,
    stepDelayMs: 700,
    steps: [
      { explanation: 'Write a file:', command: 'write /hello.txt "Hello from one-tool"' },
      { explanation: 'Read it back:', command: 'cat /hello.txt' },
      { explanation: 'List the root directory:', command: 'ls /' },
      { explanation: 'See all available commands:', command: 'help' },
    ],
  },
  {
    id: '02-custom-command',
    title: 'Custom Command',
    description: 'Register a domain-specific command and compose it with builtins.',
    browserRunnable: true,
    requiresApiKey: false,
    sourceFile: 'examples/02-custom-command.ts',
    runtimeKind: 'custom-command',
    autoPlay: true,
    stepDelayMs: 800,
    steps: [
      { explanation: 'List commands (custom ones show up too):', command: 'help' },
      {
        explanation: 'Look up a ticket and extract its status:',
        command: 'ticket lookup T-123 | json get status',
      },
      {
        explanation: 'Extract a nested field from the same ticket payload:',
        command: 'ticket lookup T-123 | json get owner.email',
      },
    ],
  },
  {
    id: '03-readonly-agent',
    title: 'Read-Only Agent',
    description: 'Use the readOnly preset to restrict to safe commands.',
    browserRunnable: true,
    requiresApiKey: false,
    sourceFile: 'examples/03-readonly-agent.ts',
    runtimeKind: 'readOnly',
    autoPlay: true,
    stepDelayMs: 700,
    steps: [
      { explanation: 'Read commands work:', command: 'cat /logs/app.log' },
      { explanation: 'List files:', command: 'ls /' },
      { explanation: 'Search works:', command: 'grep ERROR /logs/app.log' },
      {
        explanation: 'Mutating commands are unavailable in the preset:',
        command: 'write /test.txt "should fail"',
      },
    ],
  },
  {
    id: '04-detailed-execution',
    title: 'Detailed Execution',
    description: 'Inspect exit codes, traces, and structured execution results.',
    browserRunnable: true,
    requiresApiKey: false,
    sourceFile: 'examples/04-detailed-execution.ts',
    runtimeKind: 'demo',
    executionKind: 'runDetailed',
    autoPlay: true,
    stepDelayMs: 900,
    steps: [
      { explanation: 'Count errors in the log:', command: 'grep -c ERROR /logs/app.log' },
      {
        explanation: 'Chain with fallback:',
        command: 'cat /config/missing.json || cat /config/default.json',
      },
      {
        explanation: 'Pipeline with multiple stages:',
        command: 'cat /logs/app.log | grep timeout | tail -n 1',
      },
    ],
  },
  {
    id: '05-adapters',
    title: 'Search & Fetch Adapters',
    description: 'Use search and fetch commands with pluggable adapter backends.',
    browserRunnable: true,
    requiresApiKey: false,
    sourceFile: 'examples/05-adapters.ts',
    runtimeKind: 'demo',
    autoPlay: true,
    stepDelayMs: 850,
    steps: [
      { explanation: 'Search the knowledge base:', command: 'search refund timeout' },
      { explanation: 'Fetch structured data:', command: 'fetch order:123' },
      { explanation: 'Extract a nested field:', command: 'fetch order:123 | json get customer.email' },
      {
        explanation: 'Save search results to a file:',
        command: 'search refund timeout | write /reports/refund.txt',
      },
      { explanation: 'Verify the saved file:', command: 'cat /reports/refund.txt' },
    ],
  },
  {
    id: '06-browser-persistence',
    title: 'Browser Persistence',
    description: 'Use BrowserVFS with IndexedDB for data that survives page reloads.',
    browserRunnable: true,
    requiresApiKey: false,
    sourceFile: 'examples/06-browser-persistence.ts',
    runtimeKind: 'browser-persistence',
    autoPlay: true,
    stepDelayMs: 850,
    steps: [
      {
        explanation: 'Write a persistent file:',
        command: 'write /notes/persistent.txt "This survives reloads"',
      },
      {
        explanation: 'Read it back. Reload the page and rerun this step to confirm persistence.',
        command: 'cat /notes/persistent.txt',
      },
      { explanation: 'List persistent files:', command: 'ls /notes' },
    ],
  },
  {
    id: '07-mcp-server',
    title: 'MCP Server',
    description: 'Expose the runtime as a Model Context Protocol tool for Claude Code and other clients.',
    browserRunnable: false,
    requiresApiKey: false,
    sourceFile: 'examples/07-mcp-server.ts',
  },
  {
    id: '08-llm-agent',
    title: 'LLM Agent',
    description:
      'Wire the runtime to an OpenAI-compatible browser agent and watch it solve tasks autonomously.',
    browserRunnable: true,
    requiresApiKey: true,
    sourceFile: 'examples/08-llm-agent.ts',
    runtimeKind: 'demo',
  },
];

export function getExample(id: string): ExampleDef | undefined {
  return examples.find((e) => e.id === id);
}
