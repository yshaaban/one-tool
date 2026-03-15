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

export const builtinCommandGroupNames: readonly BuiltinCommandGroupName[] = Object.freeze(
  Object.keys(builtinCommandGroups) as BuiltinCommandGroupName[],
);

export interface BuiltinCommandSelection {
  preset?: BuiltinCommandPresetName;
  includeGroups?: BuiltinCommandGroupName[];
  excludeCommands?: string[];
}

export interface CreateCommandRegistryOptions extends BuiltinCommandSelection, RegisterCommandsOptions {
  commands?: Iterable<CommandSpec>;
}

export const builtinCommandPresets = {
  full: {},
  readOnly: {
    includeGroups: ['system', 'fs', 'text', 'adapters', 'data'],
    excludeCommands: ['append', 'cp', 'memory', 'mkdir', 'mv', 'rm', 'write'],
  },
  filesystem: {
    includeGroups: ['system', 'fs', 'text'],
    excludeCommands: ['memory'],
  },
  textOnly: {
    includeGroups: ['system', 'text'],
    excludeCommands: ['memory'],
  },
  dataOnly: {
    includeGroups: ['system', 'adapters', 'data'],
    excludeCommands: ['memory'],
  },
} as const satisfies Record<string, Omit<BuiltinCommandSelection, 'preset'>>;

export type BuiltinCommandPresetName = keyof typeof builtinCommandPresets;

export const builtinCommandPresetNames: readonly BuiltinCommandPresetName[] = Object.freeze(
  Object.keys(builtinCommandPresets) as BuiltinCommandPresetName[],
);

freezeBuiltinSelections(builtinCommandPresets);

function isBuiltinCommandGroupName(value: string): value is BuiltinCommandGroupName {
  return Object.hasOwn(builtinCommandGroups, value);
}

function isBuiltinCommandPresetName(value: string): value is BuiltinCommandPresetName {
  return Object.hasOwn(builtinCommandPresets, value);
}

function getBuiltinCommandPreset(name: BuiltinCommandPresetName): Omit<BuiltinCommandSelection, 'preset'> {
  if (!isBuiltinCommandPresetName(name)) {
    throw new Error(`unknown builtin command preset: ${String(name)}`);
  }
  return builtinCommandPresets[name];
}

function resolveBuiltinSelection(selection: BuiltinCommandSelection): Required<BuiltinCommandSelection> {
  const preset = selection.preset;
  const baseSelection = preset ? getBuiltinCommandPreset(preset) : undefined;

  return {
    preset: preset ?? 'full',
    includeGroups: selection.includeGroups ?? baseSelection?.includeGroups ?? [...builtinCommandGroupNames],
    excludeCommands: [...(baseSelection?.excludeCommands ?? []), ...(selection.excludeCommands ?? [])],
  };
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
  const resolved = resolveBuiltinSelection(selection);
  const excluded = new Set(resolved.excludeCommands);
  const specs: CommandSpec[] = [];

  for (const groupName of selectedGroupNames(resolved.includeGroups)) {
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

    switch (onConflict) {
      case 'skip':
        continue;
      case 'replace':
        registry.replace(spec);
        continue;
      case 'error':
        registry.register(spec); // throws — name is already registered
        break;
      default: {
        const _exhaustive: never = onConflict;
        throw new Error(`unknown conflict mode: ${_exhaustive}`);
      }
    }
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
    registerCommands(registry, commands, onConflict === undefined ? {} : { onConflict });
  }

  return registry;
}

function freezeBuiltinSelections(selections: Record<string, Omit<BuiltinCommandSelection, 'preset'>>): void {
  for (const selection of Object.values(selections)) {
    if (selection.includeGroups !== undefined) {
      Object.freeze(selection.includeGroups);
    }
    if (selection.excludeCommands !== undefined) {
      Object.freeze(selection.excludeCommands);
    }
    Object.freeze(selection);
  }

  Object.freeze(selections);
}
