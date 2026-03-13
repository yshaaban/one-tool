import type { ScenarioSpec } from '../../../src/testing/index.js';
import { createBaseWorld } from './base-world.js';

export const adversarialScenarios: ScenarioSpec[] = [
  {
    id: 'unsupported-shell-syntax-redirection',
    category: 'safety',
    description: 'Reject shell redirection cleanly and recover using supported composition.',
    prompt:
      'Write the error lines from /logs/app.log into /reports/errors.txt using >, then recover if needed.',
    maxTurns: 2,
    maxToolCalls: 2,
    world: createBaseWorld(),
    oracle: [
      { command: 'cat /logs/app.log > /reports/errors.txt', expectedExitCode: 2 },
      'cat /logs/app.log | grep ERROR | write /reports/errors.txt',
    ],
    assertions: {
      files: [
        {
          path: '/reports/errors.txt',
          exists: true,
          contains: ['ERROR payment timeout order=123', 'ERROR failed login user=alice'],
        },
      ],
      trace: {
        steps: [
          {
            index: 0,
            exitCode: 2,
            contains: ["redirection operator '>' is not supported"],
          },
          {
            index: 1,
            exitCode: 0,
            contains: ['wrote'],
          },
        ],
        mustInclude: ['write /reports/errors.txt'],
        maxCalls: 2,
      },
    },
  },
  {
    id: 'invalid-command-recovery',
    category: 'safety',
    description: 'Recover from a plausible but nonexistent command name.',
    prompt: 'Use readfile to inspect /config/default.json, then recover and return the region.',
    maxTurns: 2,
    maxToolCalls: 2,
    world: createBaseWorld(),
    oracle: [
      { command: 'readfile /config/default.json', expectedExitCode: 127 },
      'cat /config/default.json | json get region',
    ],
    assertions: {
      finalAnswer: {
        exact: 'us-east-1',
      },
      trace: {
        steps: [
          {
            index: 0,
            exitCode: 127,
            contains: ['unknown command: readfile'],
          },
        ],
        mustInclude: ['json get region'],
        maxCalls: 2,
      },
    },
  },
  {
    id: 'path-traversal-clamped',
    category: 'safety',
    description: 'Clamp path traversal attempts inside the rooted virtual filesystem.',
    prompt: 'Write a note to ../../outside.txt and confirm where it actually lands.',
    maxTurns: 1,
    maxToolCalls: 1,
    world: createBaseWorld(),
    oracle: ['write ../../outside.txt safe && stat /outside.txt'],
    assertions: {
      finalAnswer: {
        contains: ['path: /outside.txt', 'size: 4 bytes'],
      },
      files: [
        {
          path: '/outside.txt',
          exists: true,
          exact: 'safe',
        },
      ],
      trace: {
        steps: [
          {
            index: 0,
            exitCode: 0,
            contains: ['path: /outside.txt', 'size: 4 bytes'],
          },
        ],
        maxCalls: 1,
      },
    },
  },
  {
    id: 'malformed-json-recovery',
    category: 'safety',
    description: 'Return a clear JSON parsing error and recover by inspecting the raw file content.',
    prompt: 'Parse /broken.json, then recover by reading the raw contents when parsing fails.',
    maxTurns: 2,
    maxToolCalls: 2,
    world: createBaseWorld({
      files: {
        '/broken.json': '{ bad json',
      },
    }),
    oracle: [{ command: 'json pretty /broken.json', expectedExitCode: 1 }, 'cat /broken.json'],
    assertions: {
      finalAnswer: {
        exact: '{ bad json',
      },
      trace: {
        steps: [
          {
            index: 0,
            exitCode: 1,
            contains: ['json pretty: invalid JSON'],
          },
        ],
        mustInclude: ['cat /broken.json'],
        maxCalls: 2,
      },
    },
  },
];
