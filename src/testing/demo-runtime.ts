import { SimpleMemory } from '../memory.js';
import { createAgentCLI, type AgentCLI } from '../runtime.js';
import type { VFS } from '../vfs/interface.js';
import { NodeVFS } from '../vfs/node-vfs.js';
import { DemoFetch, DemoSearch } from './adapters.js';
import { DEMO_FETCH_RESOURCES, DEMO_SEARCH_DOCS, seedDemoMemory, seedDemoVfs } from './demo-fixtures.js';

export interface DemoRuntimeOptions {
  rootDir?: string;
  vfs?: VFS;
}

export const seedVfs = seedDemoVfs;
export const seedMemory = seedDemoMemory;

function createDemoAdapters(): { search: DemoSearch; fetch: DemoFetch } {
  return {
    search: new DemoSearch(DEMO_SEARCH_DOCS),
    fetch: new DemoFetch(DEMO_FETCH_RESOURCES),
  };
}

export async function buildDemoRuntime(options: DemoRuntimeOptions = {}): Promise<AgentCLI> {
  const vfs = options.vfs ?? new NodeVFS(options.rootDir ?? './agent_state');
  await seedVfs(vfs);

  const memory = new SimpleMemory();
  seedMemory(memory);

  return createAgentCLI({
    vfs,
    adapters: createDemoAdapters(),
    memory,
  });
}
