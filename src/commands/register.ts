import { CommandRegistry } from './core.js';
import type { CommandSpec } from './core.js';
import { adapterCommands } from './groups/adapters.js';
import { dataCommands } from './groups/data.js';
import { fsCommands } from './groups/fs.js';
import { systemCommands } from './groups/system.js';
import { textCommands } from './groups/text.js';

export type RegisterConflictMode = 'error' | 'replace' | 'skip';

export interface RegisterCommandsOptions {
  onConflict?: RegisterConflictMode;
}

export const builtinCommandGroups = {
  system: systemCommands,
  fs: fsCommands,
  text: textCommands,
  adapters: adapterCommands,
  data: dataCommands,
} as const satisfies Record<string, readonly CommandSpec[]>;

export type BuiltinCommandGroupName = keyof typeof builtinCommandGroups;

export const builtinCommandGroupNames: BuiltinCommandGroupName[] = Object.keys(
  builtinCommandGroups,
) as BuiltinCommandGroupName[];

export interface BuiltinCommandSelection {
  includeGroups?: BuiltinCommandGroupName[];
  excludeCommands?: string[];
}

export interface CreateCommandRegistryOptions extends BuiltinCommandSelection, RegisterCommandsOptions {
  commands?: Iterable<CommandSpec>;
}

function isBuiltinCommandGroupName(value: string): value is BuiltinCommandGroupName {
  return Object.hasOwn(builtinCommandGroups, value);
}

function selectedGroupNames(includeGroups: BuiltinCommandGroupName[] | undefined): BuiltinCommandGroupName[] {
  if (includeGroups === undefined) {
    return [...builtinCommandGroupNames];
  }

  const names: BuiltinCommandGroupName[] = [];
  const seen = new Set<BuiltinCommandGroupName>();
  for (const name of includeGroups) {
    if (!isBuiltinCommandGroupName(name)) {
      throw new Error(`unknown builtin command group: ${String(name)}`);
    }
    if (!seen.has(name)) {
      seen.add(name);
      names.push(name);
    }
  }
  return names;
}

export function listBuiltinCommands(selection: BuiltinCommandSelection = {}): CommandSpec[] {
  const excluded = new Set(selection.excludeCommands ?? []);
  const specs: CommandSpec[] = [];

  for (const groupName of selectedGroupNames(selection.includeGroups)) {
    for (const spec of builtinCommandGroups[groupName]) {
      if (!excluded.has(spec.name)) {
        specs.push(spec);
      }
    }
  }

  return specs;
}

export function registerCommands(
  registry: CommandRegistry,
  specs: Iterable<CommandSpec>,
  options: RegisterCommandsOptions = {},
): void {
  const onConflict = options.onConflict ?? 'error';

  for (const spec of specs) {
    if (!registry.has(spec.name)) {
      registry.register(spec);
      continue;
    }

    if (onConflict === 'skip') {
      continue;
    }
    if (onConflict === 'replace') {
      registry.replace(spec);
      continue;
    }

    registry.register(spec);
  }
}

export function registerBuiltinCommands(
  registry: CommandRegistry,
  selection: BuiltinCommandSelection = {},
  options: RegisterCommandsOptions = {},
): void {
  registerCommands(registry, listBuiltinCommands(selection), options);
}

export function createCommandRegistry(options: CreateCommandRegistryOptions = {}): CommandRegistry {
  const { commands, onConflict, ...selection } = options;
  const registry = new CommandRegistry();
  registerBuiltinCommands(registry, selection);

  if (commands !== undefined) {
    const registerOptions: RegisterCommandsOptions = {};
    if (onConflict !== undefined) {
      registerOptions.onConflict = onConflict;
    }
    registerCommands(registry, commands, registerOptions);
  }

  return registry;
}
