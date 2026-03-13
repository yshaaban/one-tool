export { CommandRegistry } from './core.js';
export type { CommandContext, CommandHandler, CommandSpec } from './core.js';

export {
  builtinCommandGroupNames,
  builtinCommandGroups,
  builtinCommandPresetNames,
  builtinCommandPresets,
  createCommandRegistry,
  listBuiltinCommands,
  registerBuiltinCommands,
  registerCommands,
} from './register.js';
export type {
  BuiltinCommandGroupName,
  BuiltinCommandPresetName,
  BuiltinCommandSelection,
  CreateCommandRegistryOptions,
  RegisterCommandsOptions,
  RegisterConflictMode,
} from './register.js';

export { adapterCommands, fetch, search } from './groups/adapters.js';
export { calc, dataCommands, json } from './groups/data.js';
export { append, cat, cp, diff, find, fsCommands, ls, mkdir, mv, rm, stat, write } from './groups/fs.js';
export { help, memory, systemCommands } from './groups/system.js';
export { echo, grep, head, sed, sort, tail, textCommands, tr, uniq, wc } from './groups/text.js';
