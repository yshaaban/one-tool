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
