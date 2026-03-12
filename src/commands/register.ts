import type { CommandRegistry, CommandSpec } from './core.js';
import { adapterCommands } from './groups/adapters.js';
import { dataCommands } from './groups/data.js';
import { fsCommands } from './groups/fs.js';
import { systemCommands } from './groups/system.js';
import { textCommands } from './groups/text.js';

const builtinCommands: CommandSpec[] = [
  ...systemCommands,
  ...fsCommands,
  ...textCommands,
  ...adapterCommands,
  ...dataCommands,
];

export function registerBuiltinCommands(registry: CommandRegistry): void {
  for (const spec of builtinCommands) {
    registry.register(spec);
  }
}
