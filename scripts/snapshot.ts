import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { errorMessage } from '../src/utils.js';
import { writeCommandSnapshots } from './snapshot/commands.js';
import { writeParserSnapshots, writeUtilsSnapshots, writeVfsSnapshots } from './snapshot/foundation.js';
import { writeRuntimeSnapshots } from './snapshot/runtime.js';
import { writeScenarioSnapshots } from './snapshot/scenarios.js';
import { SNAPSHOT_ROOT, writeJson } from './snapshot/shared.js';

const SNAPSHOT_SCHEMA_VERSION = 2;

async function main(): Promise<void> {
  await rm(SNAPSHOT_ROOT, { recursive: true, force: true });
  await mkdir(SNAPSHOT_ROOT, { recursive: true });

  const parserCount = await writeParserSnapshots();
  const vfsCount = await writeVfsSnapshots();
  const utilsCount = await writeUtilsSnapshots();
  const commandCount = await writeCommandSnapshots();
  const runtimeCount = await writeRuntimeSnapshots();
  const scenarioCount = await writeScenarioSnapshots();

  await writeJson(path.join(SNAPSHOT_ROOT, 'manifest.json'), {
    version: SNAPSHOT_SCHEMA_VERSION,
    domains: {
      parser: parserCount,
      vfs: vfsCount,
      utils: utilsCount,
      commands: commandCount,
      runtime: runtimeCount,
      scenarios: scenarioCount,
    },
  });
}

main().catch(function (caught) {
  console.error(errorMessage(caught));
  process.exitCode = 1;
});
