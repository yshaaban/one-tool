export interface TrParityCase {
  id: string;
  name: string;
  args: string[];
  stdin: Uint8Array;
}

export const TR_PARITY_CASES: TrParityCase[] = [
  {
    id: 'translate-lowercase-uppercase',
    name: 'translate lowercase to uppercase',
    args: ['a-z', 'A-Z'],
    stdin: Uint8Array.from([98, 97, 110, 97, 110, 97, 10]),
  },
  {
    id: 'delete-digits',
    name: 'delete digits',
    args: ['-d', '0-9'],
    stdin: Uint8Array.from([97, 49, 98, 50, 99, 51, 10]),
  },
  {
    id: 'squeeze-spaces',
    name: 'squeeze spaces',
    args: ['-s', ' '],
    stdin: Uint8Array.from([97, 32, 32, 32, 98, 10]),
  },
  {
    id: 'delete-then-squeeze-newlines',
    name: 'delete then squeeze newlines',
    args: ['-ds', '0-9', '\\n'],
    stdin: Uint8Array.from([97, 49, 10, 10, 50, 98, 10]),
  },
  {
    id: 'complement-translation',
    name: 'complement translation',
    args: ['-c', 'a', 'z'],
    stdin: Uint8Array.from([97, 98, 10]),
  },
  {
    id: 'truncate-set1-to-string2',
    name: 'truncate set1 to string2 length',
    args: ['-t', 'abcd', 'xy'],
    stdin: Uint8Array.from([97, 98, 99, 100, 10]),
  },
  {
    id: 'paired-case-classes',
    name: 'paired case classes',
    args: ['[:lower:]', '[:upper:]'],
    stdin: Uint8Array.from([97, 98, 99, 49, 50, 51, 10]),
  },
];
