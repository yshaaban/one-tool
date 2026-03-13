import type { ScenarioSpec } from '../../../src/testing/index.js';
import { generateLargeLog } from '../../../src/testing/demo-fixtures.js';
import { createBaseWorld } from './base-world.js';

export const coreScenarios: ScenarioSpec[] = [
  {
    id: 'help-discovery-tail',
    category: 'discovery',
    description: 'Discover the tail command and use it to inspect the end of the app log.',
    prompt: 'Use the runtime to find the right command and show the last three lines of /logs/app.log.',
    maxTurns: 2,
    maxToolCalls: 2,
    world: createBaseWorld(),
    oracle: ['help tail', 'tail -n 3 /logs/app.log'],
    assertions: {
      finalAnswer: {
        exact: [
          '2026-03-12T10:01:12Z WARN retry scheduled order=124',
          '2026-03-12T10:02:10Z ERROR failed login user=alice',
          '2026-03-12T10:03:55Z INFO healthcheck ok',
        ].join('\n'),
      },
      trace: {
        mustInclude: ['help tail', 'tail -n 3 /logs/app.log'],
        steps: [
          {
            index: 0,
            exitCode: 0,
            contains: ['Usage: tail [-n N] [path]'],
          },
        ],
        maxCalls: 2,
      },
    },
  },
  {
    id: 'log-error-count',
    category: 'composition',
    description: 'Count error lines in the main app log.',
    prompt: 'How many ERROR lines are in /logs/app.log?',
    maxTurns: 1,
    maxToolCalls: 1,
    world: createBaseWorld(),
    oracle: ['grep -c ERROR /logs/app.log'],
    assertions: {
      finalAnswer: {
        exact: '3',
      },
      trace: {
        maxCalls: 1,
      },
    },
  },
  {
    id: 'timeout-tail',
    category: 'composition',
    description: 'Filter timeout-related log lines and keep only the most recent ones.',
    prompt: 'Show the last two timeout-related lines from /logs/app.log.',
    maxTurns: 1,
    maxToolCalls: 1,
    world: createBaseWorld(),
    oracle: ['cat /logs/app.log | grep timeout | tail -n 2'],
    assertions: {
      finalAnswer: {
        exact: [
          '2026-03-12T10:01:10Z ERROR payment timeout order=123',
          '2026-03-12T10:01:11Z ERROR payment timeout order=124',
        ].join('\n'),
      },
      trace: {
        mustInclude: ['|'],
        maxCalls: 1,
      },
    },
  },
  {
    id: 'fallback-config',
    category: 'structured',
    description: 'Recover from a missing prod config by falling back to the default config.',
    prompt: 'If /config/prod-missing.json is absent, tell me the default region instead.',
    maxTurns: 1,
    maxToolCalls: 1,
    world: createBaseWorld(),
    oracle: ['cat /config/prod-missing.json || cat /config/default.json | json get region'],
    assertions: {
      finalAnswer: {
        exact: 'us-east-1',
      },
      trace: {
        mustInclude: ['||'],
        maxCalls: 1,
      },
    },
  },
  {
    id: 'fetch-json-field',
    category: 'structured',
    description: 'Fetch structured order data and extract multiple fields from it.',
    prompt: 'Look up order 123 and return the customer email and amount.',
    maxTurns: 2,
    maxToolCalls: 2,
    world: createBaseWorld(),
    oracle: ['fetch order:123 | json get customer.email', 'fetch order:123 | json get amount'],
    assertions: {
      finalAnswer: {
        exact: '1499',
      },
      trace: {
        mustInclude: ['json get customer.email', 'json get amount'],
        steps: [
          {
            index: 0,
            exitCode: 0,
            exact: 'buyer@acme.example',
          },
        ],
        maxCalls: 2,
      },
    },
  },
  {
    id: 'search-write-report',
    category: 'files',
    description: 'Search the knowledge base and persist the results into a report file.',
    prompt: 'Search for refund timeout information, write it to /reports/refund.txt, then verify the file.',
    maxTurns: 2,
    maxToolCalls: 2,
    world: createBaseWorld(),
    oracle: ['search refund timeout | write /reports/refund.txt', 'cat /reports/refund.txt'],
    assertions: {
      files: [
        {
          path: '/reports/refund.txt',
          exists: true,
          contains: ['refund', 'timeout'],
        },
      ],
      trace: {
        mustInclude: ['/reports/refund.txt'],
        maxCalls: 2,
      },
    },
  },
  {
    id: 'file-copy-and-append',
    category: 'files',
    description: 'Copy a report draft, append a new line, and verify the resulting report.',
    prompt:
      'Copy the QBR draft into /reports/qbr-v1.md, append an owner confirmation line, and show the result.',
    maxTurns: 3,
    maxToolCalls: 3,
    world: createBaseWorld(),
    oracle: [
      'cp /drafts/qbr.md /reports/qbr-v1.md',
      'append /reports/qbr-v1.md "- Owner confirmed"',
      'cat /reports/qbr-v1.md',
    ],
    assertions: {
      files: [
        {
          path: '/reports/qbr-v1.md',
          exists: true,
          contains: ['# QBR draft', '- Owner confirmed'],
        },
      ],
      trace: {
        mustInclude: ['cp /drafts/qbr.md /reports/qbr-v1.md', 'append /reports/qbr-v1.md'],
        maxCalls: 3,
      },
    },
  },
  {
    id: 'memory-distill-owner',
    category: 'memory',
    description: 'Extract the Acme owner from a file and store that fact in memory.',
    prompt: 'Find the Acme account owner, store it in memory, and confirm you can retrieve it from memory.',
    maxTurns: 2,
    maxToolCalls: 2,
    world: createBaseWorld(),
    oracle: ['grep "^Owner:" /accounts/acme.md | memory store', 'memory search sara@example.com'],
    assertions: {
      finalAnswer: {
        contains: ['sara@example.com'],
      },
      memory: {
        contains: ['Owner: sara@example.com'],
      },
      trace: {
        mustInclude: ['grep "^Owner:" /accounts/acme.md', 'memory store'],
        maxCalls: 2,
      },
    },
  },
  {
    id: 'binary-recovery-logo',
    category: 'binary',
    description: 'Recover safely from a binary-file read by switching to metadata inspection.',
    prompt: 'Inspect /images/logo.png safely. If reading it as text fails, recover and inspect its metadata.',
    maxTurns: 2,
    maxToolCalls: 2,
    world: createBaseWorld(),
    oracle: [{ command: 'cat /images/logo.png', expectedExitCode: 1 }, 'stat /images/logo.png'],
    assertions: {
      finalAnswer: {
        contains: ['path: /images/logo.png', 'media_type: image/png'],
      },
      trace: {
        forbidden: ['rm /images/logo.png'],
        steps: [
          {
            index: 0,
            exitCode: 1,
            contains: ['binary file', 'Use: stat /images/logo.png'],
          },
          {
            index: 1,
            exitCode: 0,
            contains: ['media_type: image/png'],
          },
        ],
        maxCalls: 2,
      },
    },
  },
  {
    id: 'overflow-navigation-large-log',
    category: 'overflow',
    description:
      'Navigate overflow output through the saved spill file and finish the task deterministically.',
    prompt:
      'The large log will overflow normal output. Navigate through the saved spill file and count bob timeout entries.',
    maxTurns: 2,
    maxToolCalls: 2,
    world: createBaseWorld({
      files: {
        '/logs/large.log': generateLargeLog(),
      },
      outputLimits: {
        maxLines: 50,
      },
    }),
    oracle: ['cat /logs/large.log', 'cat /.system/cmd-output/cmd-0001.txt | grep "timeout user=bob" | wc -l'],
    assertions: {
      finalAnswer: {
        exact: '15',
      },
      files: [
        {
          path: '/.system/cmd-output/cmd-0001.txt',
          exists: true,
          contains: ['timeout user=bob'],
        },
      ],
      trace: {
        steps: [
          {
            index: 0,
            exitCode: 0,
            contains: [
              '--- output truncated (300 lines, 13.7KB) ---',
              'Full output: /.system/cmd-output/cmd-0001.txt',
            ],
          },
        ],
        mustInclude: ['/.system/cmd-output/cmd-0001.txt'],
        maxCalls: 2,
      },
    },
  },
];
