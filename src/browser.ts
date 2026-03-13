// Browser-safe re-export — excludes NodeVFS, MCP, and testing (which pulls NodeVFS).

// Core runtime
export { AgentCLI, createAgentCLI } from './runtime.js';
export type {
  AgentCLIOptions,
  AgentCLIOutputLimits,
  CommandExecutionTrace,
  PipelineExecutionTrace,
  PipelineSkippedReason,
  PresentationStdoutMode,
  RunExecution,
  RunPresentation,
  ToolDescriptionVariant,
} from './runtime.js';
export type { AgentCLIExecutionPolicy } from './execution-policy.js';

// VFS interface + browser-safe backends
export type { VFS, VFileInfo } from './vfs/interface.js';
export type { VfsErrorCode, VfsErrorOptions } from './vfs/errors.js';
export { BrowserVFS } from './vfs/browser-vfs.js';
export { VfsError, isVfsError, toVfsError } from './vfs/errors.js';
export { MemoryVFS } from './vfs/memory-vfs.js';
export type { BrowserVFSOpenOptions } from './vfs/browser-vfs.js';
export type { MemoryVFSOptions } from './vfs/memory-vfs.js';
export type { ResolvedVfsResourcePolicy, VfsPolicyOptions, VfsResourcePolicy } from './vfs/policy.js';

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
  diff,
  createCommandRegistry,
  dataCommands,
  fetch,
  find,
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
  sed,
  sort,
  stat,
  systemCommands,
  tail,
  textCommands,
  tr,
  uniq,
  wc,
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
export type { BuildToolDefinitionOptions, ToolDefinition } from './tool-schema.js';
