from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Literal, TypeAlias, TypeVar

from ..execution_policy import ResolvedAgentCLIExecutionPolicy
from ..memory import SimpleMemory
from ..types import CommandResult, ToolAdapters
from ..vfs.interface import VFS

AdapterName = Literal["search", "fetch"]
T = TypeVar("T")
MaybeAwaitable: TypeAlias = T | Awaitable[T]
CommandHandler: TypeAlias = Callable[
    ["CommandContext", list[str], bytes],
    MaybeAwaitable[CommandResult],
]


@dataclass(frozen=True, slots=True)
class CommandSpec:
    name: str
    summary: str
    usage: str
    details: str
    handler: CommandHandler
    accepts_stdin: bool | None = None
    min_args: int | None = None
    max_args: int | None = None
    requires_adapter: AdapterName | None = None
    conformance_args: tuple[str, ...] = ()


class CommandRegistry:
    def __init__(self) -> None:
        self._commands: dict[str, CommandSpec] = {}

    def register(self, spec: CommandSpec) -> None:
        if spec.name in self._commands:
            raise ValueError(f"command already registered: {spec.name}")
        self._commands[spec.name] = spec

    def has(self, name: str) -> bool:
        return name in self._commands

    def get(self, name: str) -> CommandSpec | None:
        return self._commands.get(name)

    def replace(self, spec: CommandSpec) -> None:
        if spec.name not in self._commands:
            raise ValueError(f"command not registered: {spec.name}")
        self._commands[spec.name] = spec

    def unregister(self, name: str) -> bool:
        return self._commands.pop(name, None) is not None

    def all(self) -> list[CommandSpec]:
        return sorted(self._commands.values(), key=lambda spec: spec.name)

    def names(self) -> list[str]:
        return sorted(self._commands)


@dataclass(slots=True)
class CommandContext:
    vfs: VFS
    adapters: ToolAdapters
    memory: SimpleMemory
    registry: CommandRegistry
    execution_policy: ResolvedAgentCLIExecutionPolicy
    output_dir: str
    output_counter: int


async def maybe_await(value: MaybeAwaitable[T]) -> T:
    if inspect.isawaitable(value):
        return await value
    return value
