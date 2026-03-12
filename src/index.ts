// Core runtime
export { AgentCLI, createAgentCLI } from './runtime.js';
export type { AgentCLIOptions, AgentCLIOutputLimits } from './runtime.js';

// VFS interface + backends
export type { VFS, VFileInfo } from './vfs/interface.js';
export { MemoryVFS } from './vfs/memory-vfs.js';
export { NodeVFS, RootedVFS } from './vfs/node-vfs.js';
export { BrowserVFS } from './vfs/browser-vfs.js';

// Commands
export {
  adapterCommands,
  append,
  builtinCommandGroupNames,
  builtinCommandGroups,
  builtinCommandPresetNames,
  builtinCommandPresets,
  calc,
  cat,
  CommandRegistry,
  cp,
  createCommandRegistry,
  dataCommands,
  fetch,
  fsCommands,
  grep,
  head,
  help,
  json,
  listBuiltinCommands,
  ls,
  memory,
  mkdir,
  mv,
  registerBuiltinCommands,
  registerCommands,
  rm,
  search,
  stat,
  systemCommands,
  tail,
  textCommands,
  write,
} from './commands/index.js';
export type {
  BuiltinCommandGroupName,
  BuiltinCommandPresetName,
  BuiltinCommandSelection,
  CommandSpec,
  CommandHandler,
  CommandContext,
  CreateCommandRegistryOptions,
  RegisterCommandsOptions,
  RegisterConflictMode,
} from './commands/index.js';

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

// Testing helpers
export {
  NO_STDIN,
  createCommandConformanceCases,
  createTestCommandContext,
  createTestCommandRegistry,
  getRegisteredCommand,
  runRegisteredCommand,
  stdinText,
  stdoutText,
} from './testing/index.js';
export type {
  CommandConformanceCase,
  CommandConformanceOptions,
  CreateTestCommandContextOptions,
  RunRegisteredCommandOptions,
  RunRegisteredCommandResult,
} from './testing/index.js';
