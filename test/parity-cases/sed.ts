import { textEncoder } from '../../src/types.js';
import type { OracleWorkspaceFiles } from '../oracles/parity-harness.js';

export interface SedParityCase {
  id: string;
  name: string;
  files: OracleWorkspaceFiles;
  args: string[];
  stdin?: Uint8Array;
  inPlacePaths?: string[];
}

export const SED_PARITY_CASES: SedParityCase[] = [
  {
    id: 'basic-substitution-stdin',
    name: 'basic substitution from stdin',
    files: {},
    args: ['s/ERROR/WARN/g'],
    stdin: textEncoder.encode('ERROR one\nERROR two\n'),
  },
  {
    id: 'substitute-from-second-match',
    name: 'substitute from the second match onward',
    files: {},
    args: ['s/a/A/2g'],
    stdin: textEncoder.encode('a a a\n'),
  },
  {
    id: 'addressed-print-file',
    name: 'addressed print with -n',
    files: {
      'app.log': 'alpha\nbeta\ngamma\n',
    },
    args: ['-n', '2p', 'app.log'],
  },
  {
    id: 'clustered-ne-script-option',
    name: 'clustered -ne script option',
    files: {
      'app.log': 'alpha\nbeta\ngamma\n',
    },
    args: ['-ne', '2p', 'app.log'],
  },
  {
    id: 'insert-and-append',
    name: 'insert and append',
    files: {
      'notes.txt': 'alpha\nbeta\n',
    },
    args: ['-e', '1i\\TOP', '-e', '2a\\BOTTOM', 'notes.txt'],
  },
  {
    id: 'append-multiline-text',
    name: 'append decodes escaped newline and tab text',
    files: {
      'notes.txt': 'alpha\nbeta\n',
    },
    args: ['2a\\line A\\n\\tline B', 'notes.txt'],
  },
  {
    id: 'range-change',
    name: 'range change',
    files: {
      'notes.txt': 'a\nb\nc\nd\n',
    },
    args: ['2,3c\\X', 'notes.txt'],
  },
  {
    id: 'range-change-multiline-text',
    name: 'range change decodes escaped newline text',
    files: {
      'notes.txt': 'a\nb\nc\nd\n',
    },
    args: ['2,3c\\line 1\\nline 2', 'notes.txt'],
  },
  {
    id: 'insert-multiline-text',
    name: 'insert decodes escaped newline and tab text',
    files: {
      'notes.txt': 'alpha\nbeta\n',
    },
    args: ['2i\\line 0\\n\\tline 0.5', 'notes.txt'],
  },
  {
    id: 'replacement-multiline-text',
    name: 'replacement decodes escaped newline and tab',
    files: {},
    args: ['s/foo/bar\\n\\tbaz/'],
    stdin: textEncoder.encode('foo\n'),
  },
  {
    id: 'replacement-whole-match',
    name: 'replacement supports whole-match references',
    files: {},
    args: ['s/foo/[&]/'],
    stdin: textEncoder.encode('foo\n'),
  },
  {
    id: 'replacement-basic-backreference',
    name: 'replacement supports basic-regex backreferences',
    files: {},
    args: ['s/\\(foo\\)/[\\1]/'],
    stdin: textEncoder.encode('foo\n'),
  },
  {
    id: 'replacement-literal-dot-escape',
    name: 'replacement matches literal dot escapes',
    files: {},
    args: ['s/\\./-/'],
    stdin: textEncoder.encode('file.txt\n'),
  },
  {
    id: 'negated-regex-address-print',
    name: 'negated regex address print',
    files: {},
    args: ['-n', '/keep/!p'],
    stdin: textEncoder.encode('a\nkeep\nb\n'),
  },
  {
    id: 'negated-line-delete',
    name: 'negated line delete',
    files: {},
    args: ['2!d'],
    stdin: textEncoder.encode('a\nb\nc\n'),
  },
  {
    id: 'zero-regex-range-first-hit',
    name: 'zero regex range closes on first matching line',
    files: {},
    args: ['-n', '0,/hit/p'],
    stdin: textEncoder.encode('hit\nrest\n'),
  },
  {
    id: 'regex-range-next-hit',
    name: 'regex range closes on the next matching line',
    files: {},
    args: ['-n', '/hit/,/hit/p'],
    stdin: textEncoder.encode('hit\nrest\nhit\nlast\n'),
  },
  {
    id: 'descending-line-range',
    name: 'numeric range with descending end address closes immediately',
    files: {},
    args: ['-n', '2,1p'],
    stdin: textEncoder.encode('a\nb\nc\n'),
  },
  {
    id: 'zero-second-line-range',
    name: 'numeric range with zero end address closes immediately',
    files: {},
    args: ['-n', '1,0p'],
    stdin: textEncoder.encode('a\nb\nc\n'),
  },
  {
    id: 'zero-second-regex-range',
    name: 'regex range with zero end address closes immediately',
    files: {},
    args: ['-n', '/hit/,0p'],
    stdin: textEncoder.encode('hit\nrest\nhit\n'),
  },
  {
    id: 'negated-range-change',
    name: 'negated range change applies per matching line outside the range',
    files: {},
    args: ['1,2!c\\X'],
    stdin: textEncoder.encode('a\nb\nc\nd\n'),
  },
  {
    id: 'next-command-explicit-print',
    name: 'next command with explicit print',
    files: {
      'numbers.txt': '1\n2\n3\n',
    },
    args: ['-n', 'n;p', 'numbers.txt'],
  },
  {
    id: 'extended-regex-substitution',
    name: 'extended regex substitution',
    files: {
      'coords.txt': 'x=10,y=20\n',
    },
    args: ['-E', 's/x=([0-9]+),y=([0-9]+)/\\2,\\1/', 'coords.txt'],
  },
  {
    id: 'script-file-rewrite',
    name: 'script file rewrite',
    files: {
      'rewrite.sed': 's/foo/bar/\n2p\n',
      'input.txt': 'foo\nfoo\n',
    },
    args: ['-n', '-f', 'rewrite.sed', 'input.txt'],
  },
  {
    id: 'clustered-script-file-option',
    name: 'clustered -nEf script file option',
    files: {
      'rewrite.sed': 's/foo/bar/\n2p\n',
      'input.txt': 'foo\nfoo\n',
    },
    args: ['-nEfrewrite.sed', 'input.txt'],
  },
  {
    id: 'in-place-edit-with-backup',
    name: 'in-place edit with backup',
    files: {
      'config.env': 'REGION=us-east-1\n',
    },
    args: ['-i.bak', 's/us-east-1/us-west-2/', 'config.env'],
    inPlacePaths: ['config.env', 'config.env.bak'],
  },
];

export function mapSedFixtureArgs(args: readonly string[], mapPath: (path: string) => string): string[] {
  const mapped: string[] = [];
  let parsingOptions = true;
  let scriptResolved = false;
  let collectedScriptFromFlags = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (parsingOptions && arg === '--') {
      mapped.push(arg);
      parsingOptions = false;
      continue;
    }

    if (parsingOptions && arg.startsWith('-') && arg !== '-') {
      const remappedOption = remapSedOptionArgument(arg, args[index + 1], mapPath);
      if (remappedOption !== null) {
        mapped.push(remappedOption.argument);
        if (remappedOption.extraArgument !== undefined) {
          mapped.push(remappedOption.extraArgument);
        }
        if (remappedOption.consumedNext) {
          index += 1;
        }
        if (remappedOption.collectsScript) {
          collectedScriptFromFlags = true;
        }
        continue;
      }
    }

    if (!scriptResolved && !collectedScriptFromFlags) {
      mapped.push(arg);
      scriptResolved = true;
      parsingOptions = false;
      continue;
    }

    mapped.push(mapSedFixturePath(arg, mapPath));
    parsingOptions = false;
  }

  return mapped;
}

interface RemappedSedOptionArgument {
  argument: string;
  extraArgument?: string;
  consumedNext: boolean;
  collectsScript: boolean;
}

function remapSedOptionArgument(
  arg: string,
  nextArg: string | undefined,
  mapPath: (path: string) => string,
): RemappedSedOptionArgument | null {
  let rebuilt = '-';
  let scanIndex = 1;

  while (scanIndex < arg.length) {
    const flag = arg[scanIndex]!;
    if (flag === 'n' || flag === 'E') {
      rebuilt += flag;
      scanIndex += 1;
      continue;
    }
    if (flag === 'i') {
      rebuilt += arg.slice(scanIndex);
      return {
        argument: rebuilt,
        consumedNext: false,
        collectsScript: false,
      };
    }
    if (flag === 'e') {
      rebuilt += flag;
      const inlineScript = arg.slice(scanIndex + 1);
      if (inlineScript) {
        rebuilt += inlineScript;
        return {
          argument: rebuilt,
          consumedNext: false,
          collectsScript: true,
        };
      }
      return {
        argument: rebuilt,
        consumedNext: true,
        collectsScript: true,
        ...(nextArg === undefined ? {} : { extraArgument: nextArg }),
      };
    }
    if (flag === 'f') {
      rebuilt += flag;
      const inlinePath = arg.slice(scanIndex + 1);
      const scriptPath = inlinePath || nextArg;
      if (scriptPath === undefined) {
        return {
          argument: rebuilt,
          consumedNext: false,
          collectsScript: true,
        };
      }

      const mappedPath = mapSedFixturePath(scriptPath, mapPath);
      if (inlinePath) {
        rebuilt += mappedPath;
        return {
          argument: rebuilt,
          consumedNext: false,
          collectsScript: true,
        };
      }

      return {
        argument: rebuilt,
        extraArgument: mappedPath,
        consumedNext: true,
        collectsScript: true,
      };
    }
    return null;
  }

  return {
    argument: rebuilt,
    consumedNext: false,
    collectsScript: false,
  };
}

function mapSedFixturePath(path: string, mapPath: (path: string) => string): string {
  if (path === '-') {
    return path;
  }
  return mapPath(path);
}
