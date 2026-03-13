import type { AgentCLI, ToolDescriptionVariant } from './runtime.js';

/** OpenAI-compatible function tool definition. */
export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required: string[];
    };
  };
}

export interface BuildToolDefinitionOptions {
  descriptionVariant?: ToolDescriptionVariant;
}

/**
 * Build a tool definition from an AgentCLI instance.
 * The returned object is compatible with OpenAI, Groq, Anthropic,
 * and any provider that accepts the OpenAI tool-calling format.
 */
export function buildToolDefinition(
  cli: AgentCLI,
  toolName = 'run',
  options: BuildToolDefinitionOptions = {},
): ToolDefinition {
  return {
    type: 'function',
    function: {
      name: toolName,
      description: cli.buildToolDescription(options.descriptionVariant),
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The CLI command to execute.',
          },
        },
        required: ['command'],
      },
    },
  };
}
