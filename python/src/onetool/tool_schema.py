from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, TypedDict

from .runtime import AgentCLI, ToolDescriptionVariant


class ToolParameters(TypedDict):
    type: Literal["object"]
    properties: dict[str, object]
    required: list[str]


class ToolFunction(TypedDict):
    name: str
    description: str
    parameters: ToolParameters


class ToolDefinition(TypedDict):
    type: Literal["function"]
    function: ToolFunction


@dataclass(frozen=True, slots=True)
class BuildToolDefinitionOptions:
    description_variant: ToolDescriptionVariant | None = None


def build_tool_definition(
    cli: AgentCLI,
    tool_name: str = "run",
    options: BuildToolDefinitionOptions | None = None,
) -> ToolDefinition:
    resolved = options or BuildToolDefinitionOptions()
    return {
        "type": "function",
        "function": {
            "name": tool_name,
            "description": cli.build_tool_description(resolved.description_variant or "full-tool-description"),
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {
                        "type": "string",
                        "description": "The CLI command to execute.",
                    }
                },
                "required": ["command"],
            },
        },
    }
