import type { OracleWorkspaceFiles } from '../oracles/parity-harness.js';

export interface LsParityCase {
  args: string[];
  files: OracleWorkspaceFiles;
  id: string;
  name: string;
}

export const LS_PARITY_CASES: LsParityCase[] = [
  {
    id: 'plain-directory-listing',
    name: 'plain directory listing hides dotfiles',
    files: {
      'tree/.hidden': 'secret\n',
      'tree/nested/child.txt': 'child\n',
      'tree/visible.txt': 'visible\n',
    },
    args: ['tree'],
  },
  {
    id: 'all-listing',
    name: 'all listing includes dot entries',
    files: {
      'tree/.hidden': 'secret\n',
      'tree/visible.txt': 'visible\n',
    },
    args: ['-a', 'tree'],
  },
  {
    id: 'recursive-listing',
    name: 'recursive listing matches host shape',
    files: {
      'tree/nested/child.txt': 'child\n',
      'tree/visible.txt': 'visible\n',
    },
    args: ['-R', 'tree'],
  },
  {
    id: 'single-file-target',
    name: 'single file target',
    files: {
      'item.txt': 'hello\n',
    },
    args: ['item.txt'],
  },
  {
    id: 'non-ascii-c-locale-order',
    name: 'non-ascii names use C-locale byte ordering',
    files: {
      'tree/a': '',
      'tree/z': '',
      'tree/É': '',
      'tree/ä': '',
      'tree/Ω': '',
    },
    args: ['tree'],
  },
];

export function buildLsHostArgs(args: readonly string[], rootDir: string): string[] {
  if (args.length === 0) {
    return [...args];
  }

  const mapped = [...args];
  const last = mapped[mapped.length - 1]!;
  if (!last.startsWith('-')) {
    mapped[mapped.length - 1] = `${rootDir}/${last}`;
  }
  return mapped;
}

export function buildLsRuntimeArgs(args: readonly string[]): string[] {
  if (args.length === 0) {
    return [...args];
  }

  const mapped = [...args];
  const last = mapped[mapped.length - 1]!;
  if (!last.startsWith('-')) {
    mapped[mapped.length - 1] = `/${last}`;
  }
  return mapped;
}
