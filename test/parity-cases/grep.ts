import { textEncoder } from '../../src/types.js';
import type { OracleWorkspaceFiles } from '../oracles/parity-harness.js';

export interface GrepParityCase {
  files: OracleWorkspaceFiles;
  filePath?: string;
  flags?: string[];
  id: string;
  name: string;
  pattern: string;
  stdin?: Uint8Array;
}

export const GREP_PARITY_CASES: GrepParityCase[] = [
  {
    id: 'ignore-case-with-line-numbers',
    name: 'ignore case with line numbers',
    files: {
      'app.log': 'INFO startup\nerror timeout\nWARN retry\nerror db\n',
    },
    flags: ['-i', '-n'],
    pattern: 'error',
    filePath: 'app.log',
  },
  {
    id: 'fixed-string-only-matching',
    name: 'fixed string only matching',
    files: {
      'app.log': 'error timeout\nWARN timeout\ntimeout timeout\n',
    },
    flags: ['-F', '-o'],
    pattern: 'timeout',
    filePath: 'app.log',
  },
  {
    id: 'whole-line-regex',
    name: 'whole line regex',
    files: {
      'app.log': 'WARN retry\nWARN retry later\n',
    },
    flags: ['-x'],
    pattern: 'WARN retry',
    filePath: 'app.log',
  },
  {
    id: 'count-lines-from-stdin',
    name: 'count lines from stdin',
    files: {},
    flags: ['-c'],
    pattern: 'refund',
    stdin: textEncoder.encode('refund created\nrefund updated\nskip\n'),
  },
  {
    id: 'quiet-fixed-string-from-stdin',
    name: 'quiet fixed string from stdin',
    files: {},
    flags: ['-q', '-F'],
    pattern: 'refund',
    stdin: textEncoder.encode('refund created\nskip\n'),
  },
  {
    id: 'no-matches-from-stdin',
    name: 'no matches from stdin',
    files: {},
    flags: ['-F'],
    pattern: 'missing',
    stdin: textEncoder.encode('refund created\nskip\n'),
  },
  {
    id: 'ignore-case-non-ascii-regex',
    name: 'ignore case keeps non-ascii regex distinct in C locale',
    files: {},
    flags: ['-i'],
    pattern: 'é',
    stdin: textEncoder.encode('É\né\nE\ne\n'),
  },
  {
    id: 'ignore-case-non-ascii-fixed',
    name: 'ignore case keeps non-ascii fixed strings distinct in C locale',
    files: {},
    flags: ['-F', '-i'],
    pattern: 'é',
    stdin: textEncoder.encode('É\né\nE\ne\n'),
  },
  {
    id: 'single-byte-dot-regex',
    name: 'dot regex stays byte-oriented for utf-8 input in C locale',
    files: {},
    pattern: '^.$',
    stdin: textEncoder.encode('É\né\nE\ne\n'),
  },
  {
    id: 'ascii-word-shorthand',
    name: 'word shorthand stays ascii-only in C locale',
    files: {},
    pattern: '^\\w$',
    stdin: textEncoder.encode('É\né\nE\ne\n'),
  },
];

export function buildGrepHostArgs(parityCase: GrepParityCase, rootDir: string): string[] {
  const args = [...(parityCase.flags ?? []), parityCase.pattern];
  if (parityCase.filePath !== undefined) {
    args.push(`${rootDir}/${parityCase.filePath}`);
  }
  return args;
}

export function buildGrepRuntimeArgs(parityCase: GrepParityCase): string[] {
  const args = [...(parityCase.flags ?? []), parityCase.pattern];
  if (parityCase.filePath !== undefined) {
    args.push(`/${parityCase.filePath}`);
  }
  return args;
}
