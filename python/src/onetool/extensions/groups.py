from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import TypeAlias

from ..commands.core import CommandSpec


@dataclass(frozen=True, slots=True)
class CommandGroup:
    name: str
    commands: tuple[CommandSpec, ...]


CommandSource: TypeAlias = CommandSpec | CommandGroup


def define_command_group(name: str, commands: Iterable[CommandSpec]) -> CommandGroup:
    trimmed_name = name.strip()
    if trimmed_name == "":
        raise ValueError("command group name is required")
    return CommandGroup(name=trimmed_name, commands=tuple(commands))


def collect_commands(sources: Iterable[CommandSource]) -> list[CommandSpec]:
    collected: list[CommandSpec] = []
    for source in sources:
        if isinstance(source, CommandGroup):
            collected.extend(source.commands)
            continue
        collected.append(source)
    return collected
