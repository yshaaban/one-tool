#!/usr/bin/env node
// Interactive one-tool CLI session — state persists across commands
import { createAgentCLI, MemoryVFS } from './dist/src/index.js';
import { createInterface } from 'node:readline';

const vfs = new MemoryVFS();
const cli = await createAgentCLI({ vfs });

if (process.argv.length > 2) {
  // Single command mode: node try-cli.mjs "write /hello.txt hi"
  console.log(await cli.run(process.argv.slice(2).join(' ')));
  process.exit(0);
}

// Interactive REPL
const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: 'one-tool> ' });
rl.prompt();
rl.on('line', async (line) => {
  const cmd = line.trim();
  if (!cmd || cmd === 'exit') { rl.close(); return; }
  console.log(await cli.run(cmd));
  rl.prompt();
});
