import type { CommandSpec } from '../commands/index.js';

export interface CommandGroup {
  name: string;
  commands: readonly CommandSpec[];
}

export type CommandSource = CommandSpec | CommandGroup;

export function defineCommandGroup(name: string, commands: Iterable<CommandSpec>): CommandGroup {
  const trimmedName = name.trim();
  if (trimmedName.length === 0) {
    throw new Error('command group name is required');
  }

  const collectedCommands = Object.freeze([...commands]);
  return Object.freeze({
    name: trimmedName,
    commands: collectedCommands,
  });
}

export function collectCommands(sources: Iterable<CommandSource>): CommandSpec[] {
  const collected: CommandSpec[] = [];

  for (const source of sources) {
    if ('commands' in source) {
      collected.push(...source.commands);
      continue;
    }
    collected.push(source);
  }

  return collected;
}
