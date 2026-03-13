import { createAgentCLI, type AgentCLI, type VFS, NodeVFS, SimpleMemory } from 'one-tool';
import { DemoFetch, DemoSearch } from './demo-adapters.js';
import {
  DEMO_FETCH_RESOURCES,
  DEMO_SEARCH_DOCS,
  seedDemoMemory,
  seedDemoVfs,
} from '../src/testing/demo-fixtures.js';

export interface DemoRuntimeOptions {
  rootDir?: string;
  vfs?: VFS;
}

export const seedVfs = seedDemoVfs;
export const seedMemory = seedDemoMemory;

export async function buildDemoRuntime(options: DemoRuntimeOptions = {}): Promise<AgentCLI> {
  const vfs = options.vfs ?? new NodeVFS(options.rootDir ?? './agent_state');
  await seedVfs(vfs);

  const memory = new SimpleMemory();
  seedMemory(memory);

  const runtime = await createAgentCLI({
    vfs,
    adapters: {
      search: new DemoSearch(DEMO_SEARCH_DOCS),
      fetch: new DemoFetch(DEMO_FETCH_RESOURCES),
    },
    memory,
  });

  return runtime;
}
