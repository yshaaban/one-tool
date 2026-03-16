import { SimpleMemory } from '../memory.js';
import { createAgentCLI, type AgentCLI } from '../runtime.js';
import type { ToolAdapters } from '../types.js';
import { textEncoder } from '../types.js';
import { parentPath } from '../utils.js';
import { MemoryVFS } from '../vfs/memory-vfs.js';
import { DemoFetch, DemoSearch } from './adapters.js';
import type { WorldSpec } from './scenario.js';
import { compareCLocaleText } from '../utils.js';

export async function buildWorld(world: WorldSpec): Promise<AgentCLI> {
  const vfs = new MemoryVFS();
  const memory = new SimpleMemory();

  if (world.files !== undefined) {
    const fileEntries = Object.entries(world.files).sort(function ([left], [right]) {
      return compareCLocaleText(left, right);
    });

    for (const [filePath, content] of fileEntries) {
      await vfs.mkdir(parentPath(filePath), true);
      const bytes = content instanceof Uint8Array ? new Uint8Array(content) : textEncoder.encode(content);
      await vfs.writeBytes(filePath, bytes, false);
    }
  }

  if (world.memory !== undefined) {
    for (const entry of world.memory) {
      memory.store(entry);
    }
  }

  const options = {
    vfs,
    memory,
    adapters: buildAdapters(world),
  };

  if (world.outputLimits === undefined) {
    return createAgentCLI(options);
  }

  return createAgentCLI({
    ...options,
    outputLimits: world.outputLimits,
  });
}

function buildAdapters(world: WorldSpec): ToolAdapters {
  const adapters: ToolAdapters = {};

  if (world.searchDocs !== undefined) {
    adapters.search = new DemoSearch(world.searchDocs);
  }
  if (world.fetchResources !== undefined) {
    adapters.fetch = new DemoFetch(world.fetchResources);
  }

  return adapters;
}
