// Core runtime
export { AgentCLI, createAgentCLI } from './runtime.js';
export type { AgentCLIOptions } from './runtime.js';

// VFS interface + backends
export type { VFS, VFileInfo } from './vfs/interface.js';
export { MemoryVFS } from './vfs/memory-vfs.js';
export { NodeVFS, RootedVFS } from './vfs/node-vfs.js';
export { BrowserVFS } from './vfs/browser-vfs.js';

// Commands
export { CommandRegistry, registerBuiltinCommands } from './commands/index.js';
export type { CommandSpec, CommandHandler, CommandContext } from './commands/index.js';

// Types
export type {
  CommandResult,
  SearchAdapter,
  FetchAdapter,
  ToolAdapters,
  SearchHit,
  FetchResponse,
  MemoryItem,
} from './types.js';
export { ok, err, okBytes } from './types.js';

// Memory
export { SimpleMemory } from './memory.js';

// Tool schema helpers
export { buildToolDefinition } from './tool-schema.js';
export type { ToolDefinition } from './tool-schema.js';
