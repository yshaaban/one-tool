export interface EditingWorkflowCase {
  commands: string[];
  id: string;
  title: string;
}

export const EDITING_WORKFLOW_SETUP_COMMANDS: string[] = [
  `echo -e 'import { readFile } from "fs";\\n\\nexport function loadConfig(path: string) {\\n  const raw = readFile(path);\\n  return JSON.parse(raw);\\n}\\n\\nexport function validateConfig(config: any) {\\n  if (!config.host) throw new Error("missing host");\\n  if (!config.port) throw new Error("missing port");\\n  return config;\\n}\\n\\nexport function connect(config: any) {\\n  const url = config.host + ":" + config.port;\\n  console.log("connecting to " + url);\\n  return { url, status: "connected" };\\n}' | write /src/config.ts`,
];

export const EDITING_WORKFLOW_CASES: EditingWorkflowCase[] = [
  {
    id: 'read-specific-line-range',
    title: 'read specific line range',
    commands: ['sed -n "8,12p" /src/config.ts'],
  },
  {
    id: 'single-line-substitution',
    title: 'single line substitution',
    commands: [
      'sed -i "9s/missing host/host is required/" /src/config.ts',
      'sed -n "8,12p" /src/config.ts',
    ],
  },
  {
    id: 'insert-after-line',
    title: 'insert after line 10',
    commands: [
      `sed -i '10a\\  if (config.port < 1) throw new Error("invalid port");' /src/config.ts`,
      'sed -n "9,13p" /src/config.ts',
      'wc -l /src/config.ts',
    ],
  },
  {
    id: 'delete-first-line',
    title: 'delete line 1',
    commands: ['sed -i "1d" /src/config.ts', 'sed -n "1,3p" /src/config.ts'],
  },
  {
    id: 'global-find-replace',
    title: 'global find/replace',
    commands: [
      'sed -i "s/config: any/config: Config/g" /src/config.ts',
      'grep -n Config /src/config.ts',
    ],
  },
  {
    id: 'pattern-addressed-block-replace',
    title: 'pattern-addressed block replace',
    commands: [
      'sed -n "/connect/,/^}/p" /src/config.ts',
      `sed -i '/connect/,/^}/c\\export async function connect(config: Config) {\\n  const url = new URL(config.host);\\n  url.port = String(config.port);\\n  return fetch(url);\\n}' /src/config.ts`,
      'cat /src/config.ts',
    ],
  },
  {
    id: 'multiline-append-editing',
    title: 'multi-line append editing',
    commands: [
      `echo -e 'alpha\\nbeta' | write /src/append.txt`,
      `sed -i '2a\\line A\\n\\tline B' /src/append.txt`,
      'cat /src/append.txt',
    ],
  },
  {
    id: 'multiline-replacement-editing',
    title: 'multi-line replacement editing',
    commands: [
      `echo -e 'target line' | write /src/replacement.txt`,
      `sed -i 's/target line/line one\\n\\tline two/' /src/replacement.txt`,
      'cat /src/replacement.txt',
    ],
  },
  {
    id: 'alternate-delimiter-url-rewrite',
    title: 'alternate delimiter for URLs',
    commands: [
      `echo -e 'const url = "https://example.com/api/v1";' | write /src/test.ts`,
      'cat /src/test.ts',
      'sed -i "s|https://example.com/api/v1|https://prod.example.com/api/v2|" /src/test.ts',
      'cat /src/test.ts',
    ],
  },
  {
    id: 'multi-hunk-scattered-edits',
    title: 'multi-hunk scattered edits',
    commands: [
      `echo -e 'line 1: alpha\\nline 2: beta\\nline 3: gamma\\nline 4: delta\\nline 5: epsilon\\nline 6: zeta\\nline 7: eta\\nline 8: theta' | write /src/multi.txt`,
      'sed -i -e "2s/beta/BETA_REPLACED/" -e "7s/eta/ETA_REPLACED/" /src/multi.txt',
      'cat /src/multi.txt',
    ],
  },
  {
    id: 'multiline-insert-editing',
    title: 'multi-line insert with escaped newlines',
    commands: [
      `echo -e 'alpha\\nbeta' | write /src/insert.txt`,
      `sed -i '2i\\line 0\\n\\tline 0.5' /src/insert.txt`,
      'cat /src/insert.txt',
    ],
  },
];
