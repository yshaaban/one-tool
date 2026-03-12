import type { MaybePromise, CommandResult, ToolAdapters } from '../types.js';
import type { VFS } from '../vfs/interface.js';
import { SimpleMemory } from '../memory.js';

export interface CommandSpec {
  name: string;
  summary: string;
  usage: string;
  details: string;
  handler: CommandHandler;
  /**
   * Optional metadata used by the command guide and conformance tests.
   * Built-in commands in this repo are expected to provide the applicable fields.
   */
  acceptsStdin?: boolean;
  minArgs?: number;
  maxArgs?: number;
  requiresAdapter?: keyof ToolAdapters;
  conformanceArgs?: string[];
}

export type CommandHandler = (
  ctx: CommandContext,
  args: string[],
  stdin: Uint8Array,
) => MaybePromise<CommandResult>;

export class CommandRegistry {
  private readonly commands = new Map<string, CommandSpec>();

  register(spec: CommandSpec): void {
    if (this.commands.has(spec.name)) {
      throw new Error(`command already registered: ${spec.name}`);
    }
    this.commands.set(spec.name, spec);
  }

  get(name: string): CommandSpec | undefined {
    return this.commands.get(name);
  }

  all(): CommandSpec[] {
    return [...this.commands.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  names(): string[] {
    return [...this.commands.keys()].sort((left, right) => left.localeCompare(right));
  }
}

export interface CommandContext {
  vfs: VFS;
  adapters: ToolAdapters;
  memory: SimpleMemory;
  registry: CommandRegistry;
  outputDir: string;
  outputCounter: number;
}
