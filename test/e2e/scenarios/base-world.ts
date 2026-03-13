import type { WorldSpec } from '../../../src/testing/index.js';
import {
  DEMO_FETCH_RESOURCES,
  DEMO_FILES,
  DEMO_MEMORY_ENTRIES,
  DEMO_SEARCH_DOCS,
} from '../../../src/testing/demo-fixtures.js';

export function createBaseWorld(overrides: Partial<WorldSpec> = {}): WorldSpec {
  const baseFiles: Record<string, string | Uint8Array> = {};

  for (const [filePath, content] of Object.entries(DEMO_FILES)) {
    baseFiles[filePath] = content instanceof Uint8Array ? new Uint8Array(content) : content;
  }

  return {
    files: {
      ...baseFiles,
      ...(overrides.files ?? {}),
    },
    searchDocs: overrides.searchDocs ?? DEMO_SEARCH_DOCS,
    fetchResources: overrides.fetchResources ?? DEMO_FETCH_RESOURCES,
    memory: overrides.memory ?? DEMO_MEMORY_ENTRIES,
    ...(overrides.outputLimits === undefined ? {} : { outputLimits: overrides.outputLimits }),
  };
}
