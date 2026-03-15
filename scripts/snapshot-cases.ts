import type { BuiltinCommandSelection } from '../src/commands/index.js';
import type { AgentCLIExecutionPolicy } from '../src/execution-policy.js';
import { DEMO_FETCH_RESOURCES, DEMO_SEARCH_DOCS, generateLargeLog } from '../src/testing/demo-fixtures.js';
import type { DemoSearchDocument } from '../src/testing/index.js';
import type { AgentCLIOutputLimits, ToolDescriptionVariant } from '../src/runtime.js';
import type { WorldSpec, ScenarioSpec } from '../src/testing/index.js';
import type { VfsResourcePolicy } from '../src/vfs/index.js';
import { adversarialScenarios } from '../test/e2e/scenarios/adversarial.js';
import { createBaseWorld } from '../test/e2e/scenarios/base-world.js';
import { coreScenarios } from '../test/e2e/scenarios/core.js';

export interface SnapshotDirectoryEntry {
  kind: 'dir';
}

export type SnapshotFileEntry = string | Uint8Array | SnapshotDirectoryEntry;

export interface SnapshotWorld extends Omit<WorldSpec, 'files'> {
  files?: Record<string, SnapshotFileEntry>;
}

export interface CommandSnapshotCase {
  id: string;
  commandName: string;
  snapshotGroup?: string;
  args: string[];
  stdin?: Uint8Array;
  world?: SnapshotWorld;
  executionPolicy?: AgentCLIExecutionPolicy;
  vfsResourcePolicy?: VfsResourcePolicy;
}

export type RuntimeCustomCommandId = 'echo' | 'fail' | 'burst' | 'binary' | 'longline' | 'help-override';

export interface RuntimeSnapshotCase {
  id: string;
  commandLine: string;
  world?: SnapshotWorld;
  builtinCommands?: BuiltinCommandSelection | false;
  customCommands?: RuntimeCustomCommandId[];
  outputLimits?: AgentCLIOutputLimits;
  executionPolicy?: AgentCLIExecutionPolicy;
  vfsResourcePolicy?: VfsResourcePolicy;
}

export interface RuntimeDescriptionCase {
  id: string;
  variant: ToolDescriptionVariant;
  builtinCommands?: BuiltinCommandSelection | false;
  customCommands?: RuntimeCustomCommandId[];
}

const textEncoder = new TextEncoder();

export function snapshotDir(): SnapshotDirectoryEntry {
  return { kind: 'dir' };
}

function encodeText(value: string): Uint8Array {
  return textEncoder.encode(value);
}

export const DEFAULT_ADAPTER_WORLD: SnapshotWorld = {
  searchDocs: [
    {
      title: 'Query document',
      body: 'query result appears in this document body.',
      source: 'kb://query',
    },
  ] satisfies DemoSearchDocument[],
  fetchResources: {
    'res:1': {
      ok: true,
      count: 1,
    },
  },
};

export const COMMAND_EXTRA_CASES: CommandSnapshotCase[] = [
  {
    id: 'append-existing-inline',
    commandName: 'append',
    args: ['/notes/log.txt', ' next'],
    world: {
      files: {
        '/notes/log.txt': 'start',
      },
    },
  },
  {
    id: 'append-from-stdin',
    commandName: 'append',
    args: ['/notes/log.txt'],
    stdin: encodeText(' world'),
    world: {
      files: {
        '/notes/log.txt': 'hello',
      },
    },
  },
  {
    id: 'calc-nested-expression',
    commandName: 'calc',
    args: ['(12', '*', '8)', '/', '3'],
  },
  {
    id: 'cat-text-file',
    commandName: 'cat',
    args: ['/notes/todo.txt'],
    world: {
      files: {
        '/notes/todo.txt': 'line one',
      },
    },
  },
  {
    id: 'cat-stdin-marker',
    commandName: 'cat',
    args: ['/notes/header.txt', '-', '/notes/footer.txt'],
    stdin: encodeText('body\n'),
    world: {
      files: {
        '/notes/header.txt': 'header\n',
        '/notes/footer.txt': 'footer\n',
      },
    },
  },
  {
    id: 'cat-binary-file',
    commandName: 'cat',
    args: ['/images/logo.bin'],
    world: {
      files: {
        '/images/logo.bin': Uint8Array.of(0, 1, 2, 3),
      },
    },
  },
  {
    id: 'cp-file-success',
    commandName: 'cp',
    args: ['/src.txt', '/dst.txt'],
    world: {
      files: {
        '/src.txt': 'copy me',
      },
    },
  },
  {
    id: 'diff-unified-changed-files',
    commandName: 'diff',
    args: ['-u', '/left.txt', '/right.txt'],
    world: {
      files: {
        '/left.txt': 'alpha\nbravo\n',
        '/right.txt': 'alpha\ncharlie\n',
      },
    },
  },
  {
    id: 'echo-escape-flags',
    commandName: 'echo',
    args: ['-e', 'line\\none\\tindent'],
  },
  {
    id: 'fetch-json-payload',
    commandName: 'fetch',
    args: ['order:123'],
    world: {
      fetchResources: DEMO_FETCH_RESOURCES,
    },
  },
  {
    id: 'fetch-binary-payload',
    commandName: 'fetch',
    args: ['binary:logo'],
    world: {
      fetchResources: {
        'binary:logo': Uint8Array.of(0, 1, 2, 3),
      },
    },
  },
  {
    id: 'find-filtered-json-files',
    commandName: 'find',
    args: ['/config', '--type', 'file', '--name', '*.json'],
    world: {
      files: {
        '/config/default.json': '{}\n',
        '/config/prod.json': '{}\n',
        '/config/readme.txt': 'ignore\n',
      },
    },
  },
  {
    id: 'grep-stdin-count',
    commandName: 'grep',
    args: ['-c', 'refund'],
    stdin: encodeText('refund created\nrefund updated\nskip'),
  },
  {
    id: 'head-first-two-lines',
    commandName: 'head',
    args: ['-n', '2', '/notes.txt'],
    world: {
      files: {
        '/notes.txt': 'a\nb\nc\nd',
      },
    },
  },
  {
    id: 'help-grep-detail',
    commandName: 'help',
    args: ['grep'],
  },
  {
    id: 'json-pretty-stdin',
    commandName: 'json',
    args: ['pretty'],
    stdin: encodeText('{"b":2,"a":1}'),
  },
  {
    id: 'json-get-file',
    commandName: 'json',
    args: ['get', 'user.email', '/payload.json'],
    world: {
      files: {
        '/payload.json': '{"user":{"email":"buyer@acme.example"}}',
      },
    },
  },
  {
    id: 'ls-show-hidden-with-all',
    commandName: 'ls',
    args: ['-a', '/'],
    world: {
      files: {
        '/visible.txt': 'visible',
        '/.hidden.txt': 'hidden',
      },
    },
  },
  {
    id: 'memory-store-inline',
    commandName: 'memory',
    args: ['store', 'Acme', 'prefers', 'Monday'],
  },
  {
    id: 'memory-search-existing',
    commandName: 'memory',
    args: ['search', 'payment timeout'],
    world: {
      memory: ['Acme follow-up next Monday', 'Escalate payment timeout issue'],
    },
  },
  {
    id: 'mkdir-parents-alias',
    commandName: 'mkdir',
    args: ['-p', '/reports/2026/q2'],
  },
  {
    id: 'mv-file-success',
    commandName: 'mv',
    args: ['/src.txt', '/dst.txt'],
    world: {
      files: {
        '/src.txt': 'move me',
      },
    },
  },
  {
    id: 'rm-recursive-alias',
    commandName: 'rm',
    args: ['-r', '/tree'],
    world: {
      files: {
        '/tree/a.txt': 'alpha',
        '/tree/sub/b.txt': 'beta',
      },
    },
  },
  {
    id: 'search-demo-docs',
    commandName: 'search',
    args: ['refund timeout'],
    world: {
      searchDocs: DEMO_SEARCH_DOCS,
    },
  },
  {
    id: 'sed-substitute-stdin',
    commandName: 'sed',
    args: ['s/foo/bar/g'],
    stdin: encodeText('foo\nfoo\n'),
  },
  {
    id: 'sort-versioned-file',
    commandName: 'sort',
    args: ['-V', '/versions.txt'],
    world: {
      files: {
        '/versions.txt': 'v1.10\nv1.2\nv1.3',
      },
    },
  },
  {
    id: 'stat-existing-file',
    commandName: 'stat',
    args: ['/notes/todo.txt'],
    world: {
      files: {
        '/notes/todo.txt': 'line one',
      },
    },
  },
  {
    id: 'tail-last-two-lines',
    commandName: 'tail',
    args: ['-n', '2', '/tail.txt'],
    world: {
      files: {
        '/tail.txt': '1\n2\n3\n4',
      },
    },
  },
  {
    id: 'tr-translate-stdin',
    commandName: 'tr',
    args: ['a-z', 'A-Z'],
    stdin: encodeText('banana'),
  },
  {
    id: 'uniq-counts-file',
    commandName: 'uniq',
    args: ['-c', '/repeated.txt'],
    world: {
      files: {
        '/repeated.txt': 'a\na\nb\nb\nb\n',
      },
    },
  },
  {
    id: 'wc-counts-file',
    commandName: 'wc',
    args: ['/notes.txt'],
    world: {
      files: {
        '/notes.txt': 'one two\nthree\n',
      },
    },
  },
  {
    id: 'write-from-stdin',
    commandName: 'write',
    args: ['/notes/stdin.txt'],
    stdin: encodeText('from stdin'),
  },
  {
    id: 'write-resource-limit',
    commandName: 'write',
    args: ['/notes/large.txt', 'hello'],
    vfsResourcePolicy: {
      maxFileBytes: 3,
    },
  },
];

export const RUNTIME_EXECUTION_CASES: RuntimeSnapshotCase[] = [
  {
    id: 'builtin-pipeline-error-count',
    commandLine: 'cat /logs/app.log | grep -c ERROR',
    world: createBaseWorld(),
  },
  {
    id: 'builtin-fetch-json-field',
    commandLine: 'fetch order:123 | json get customer.email',
    world: createBaseWorld(),
  },
  {
    id: 'builtin-overflow-large-log',
    commandLine: 'cat /logs/large.log',
    world: createBaseWorld({
      files: {
        '/logs/large.log': generateLargeLog(),
      },
    }),
    outputLimits: {
      maxLines: 50,
    },
  },
  {
    id: 'custom-chain-skip-metadata',
    commandLine: 'echo ok || echo skipped; fail && echo skipped2; echo final',
    builtinCommands: false,
    customCommands: ['echo', 'fail'],
  },
  {
    id: 'custom-unknown-command',
    commandLine: 'missingcmd arg',
    builtinCommands: false,
  },
  {
    id: 'custom-parse-error',
    commandLine: 'echo "unterminated',
    builtinCommands: false,
    customCommands: ['echo'],
  },
  {
    id: 'custom-truncated-burst',
    commandLine: 'burst',
    builtinCommands: false,
    customCommands: ['burst'],
    outputLimits: {
      maxLines: 1,
      maxBytes: 1024,
    },
  },
  {
    id: 'custom-binary-guard',
    commandLine: 'binary',
    builtinCommands: false,
    customCommands: ['binary'],
  },
  {
    id: 'custom-truncated-save-failure',
    commandLine: 'burst',
    builtinCommands: false,
    customCommands: ['burst'],
    outputLimits: {
      maxLines: 1,
      maxBytes: 1024,
    },
    vfsResourcePolicy: {
      maxOutputArtifactBytes: 8,
    },
  },
  {
    id: 'custom-binary-save-failure',
    commandLine: 'binary',
    builtinCommands: false,
    customCommands: ['binary'],
    vfsResourcePolicy: {
      maxOutputArtifactBytes: 3,
    },
  },
  {
    id: 'selective-builtin-registry',
    commandLine: 'ls',
    builtinCommands: {
      includeGroups: ['system', 'text'],
      excludeCommands: ['memory'],
    },
  },
];

export const RUNTIME_DESCRIPTION_CASES: RuntimeDescriptionCase[] = [
  {
    id: 'full-default',
    variant: 'full-tool-description',
  },
  {
    id: 'minimal-selective',
    variant: 'minimal-tool-description',
    builtinCommands: {
      includeGroups: ['system', 'text'],
      excludeCommands: ['memory'],
    },
  },
  {
    id: 'terse-selective',
    variant: 'terse',
    builtinCommands: {
      includeGroups: ['system', 'text'],
      excludeCommands: ['memory'],
    },
  },
  {
    id: 'empty-registry',
    variant: 'full-tool-description',
    builtinCommands: false,
  },
  {
    id: 'minimal-no-help',
    variant: 'minimal-tool-description',
    builtinCommands: false,
    customCommands: ['echo'],
  },
];

export const SCENARIO_CASES: ScenarioSpec[] = [...coreScenarios, ...adversarialScenarios];
