import { createAgentCLI, MemoryVFS } from './dist/src/index.js';
const cli = await createAgentCLI({ vfs: new MemoryVFS() });

async function run(cmd) {
  const r = await cli.run(cmd);
  console.log(`> ${cmd}`);
  console.log(r);
  console.log();
}

// Setup: create an 18-line TypeScript file
await run(`echo -e 'import { readFile } from "fs";\\n\\nexport function loadConfig(path: string) {\\n  const raw = readFile(path);\\n  return JSON.parse(raw);\\n}\\n\\nexport function validateConfig(config: any) {\\n  if (!config.host) throw new Error("missing host");\\n  if (!config.port) throw new Error("missing port");\\n  return config;\\n}\\n\\nexport function connect(config: any) {\\n  const url = config.host + ":" + config.port;\\n  console.log("connecting to " + url);\\n  return { url, status: "connected" };\\n}' | write /src/config.ts`);

console.log('=== TEST 1: Read specific line range ===');
await run('sed -n "8,12p" /src/config.ts');

console.log('=== TEST 2: Single line substitution ===');
await run('sed -i "9s/missing host/host is required/" /src/config.ts');
await run('sed -n "8,12p" /src/config.ts');

console.log('=== TEST 3: Insert after line 10 ===');
await run(`sed -i '10a\\  if (config.port < 1) throw new Error("invalid port");' /src/config.ts`);
await run('sed -n "9,13p" /src/config.ts');
await run('wc -l /src/config.ts');

console.log('=== TEST 4: Delete line 1 ===');
await run('sed -i "1d" /src/config.ts');
await run('sed -n "1,3p" /src/config.ts');

console.log('=== TEST 5: Global find/replace ===');
await run('sed -i "s/config: any/config: Config/g" /src/config.ts');
await run('grep -n Config /src/config.ts');

console.log('=== TEST 6: Pattern-addressed block replace ===');
await run('sed -n "/connect/,/^}/p" /src/config.ts');
await run(`sed -i '/connect/,/^}/c\\export async function connect(config: Config) {\\n  const url = new URL(config.host);\\n  url.port = String(config.port);\\n  return fetch(url);\\n}' /src/config.ts`);
await run('cat /src/config.ts');

console.log('=== TEST 6B: Multi-line append editing ===');
await run(`echo -e 'alpha\\nbeta' | write /src/append.txt`);
await run(`sed -i '2a\\line A\\n\\tline B' /src/append.txt`);
await run('cat /src/append.txt');

console.log('=== TEST 6C: Multi-line replacement editing ===');
await run(`echo -e 'target line' | write /src/replacement.txt`);
await run(`sed -i 's/target line/line one\\n\\tline two/' /src/replacement.txt`);
await run('cat /src/replacement.txt');

console.log('=== TEST 7: Alternate delimiter for URLs ===');
await run(`echo -e 'const url = "https://example.com/api/v1";' | write /src/test.ts`);
await run('cat /src/test.ts');
await run('sed -i "s|https://example.com/api/v1|https://prod.example.com/api/v2|" /src/test.ts');
await run('cat /src/test.ts');

console.log('=== TEST 8: Multi-hunk scattered edits ===');
await run(`echo -e 'line 1: alpha\\nline 2: beta\\nline 3: gamma\\nline 4: delta\\nline 5: epsilon\\nline 6: zeta\\nline 7: eta\\nline 8: theta' | write /src/multi.txt`);
await run('sed -i -e "2s/beta/BETA_REPLACED/" -e "7s/eta/ETA_REPLACED/" /src/multi.txt');
await run('cat /src/multi.txt');

console.log('=== TEST 9: Multi-line insert with escaped newlines ===');
await run(`echo -e 'alpha\\nbeta' | write /src/insert.txt`);
await run(`sed -i '2i\\line 0\\n\\tline 0.5' /src/insert.txt`);
await run('cat /src/insert.txt');

console.log('=== DONE ===');
