from __future__ import annotations

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from types import MappingProxyType
from typing import Literal

from .core import CommandRegistry, CommandSpec
from .groups.adapters import adapter_commands
from .groups.data import data_commands
from .groups.fs import fs_commands
from .groups.system import system_commands
from .groups.text import text_commands

RegisterConflictMode = Literal["error", "replace", "skip"]
BuiltinCommandGroupName = Literal["system", "fs", "text", "adapters", "data"]
BuiltinCommandPresetName = Literal["full", "readOnly", "filesystem", "textOnly", "dataOnly"]


@dataclass(frozen=True, slots=True)
class BuiltinCommandSelection:
    preset: BuiltinCommandPresetName | None = None
    include_groups: tuple[BuiltinCommandGroupName, ...] | None = None
    exclude_commands: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class CreateCommandRegistryOptions(BuiltinCommandSelection):
    commands: tuple[CommandSpec, ...] = ()
    on_conflict: RegisterConflictMode | None = None


builtin_command_groups = MappingProxyType(
    {
        "system": tuple(system_commands),
        "fs": tuple(fs_commands),
        "text": tuple(text_commands),
        "adapters": tuple(adapter_commands),
        "data": tuple(data_commands),
    }
)
builtin_command_group_names: tuple[BuiltinCommandGroupName, ...] = tuple(builtin_command_groups)
builtin_command_presets = MappingProxyType(
    {
        "full": BuiltinCommandSelection(),
        "readOnly": BuiltinCommandSelection(
            include_groups=("system", "fs", "text", "adapters", "data"),
            exclude_commands=("append", "cp", "memory", "mkdir", "mv", "rm", "write"),
        ),
        "filesystem": BuiltinCommandSelection(
            include_groups=("system", "fs", "text"),
            exclude_commands=("memory",),
        ),
        "textOnly": BuiltinCommandSelection(
            include_groups=("system", "text"),
            exclude_commands=("memory",),
        ),
        "dataOnly": BuiltinCommandSelection(
            include_groups=("system", "adapters", "data"),
            exclude_commands=("memory",),
        ),
    }
)
builtin_command_preset_names: tuple[BuiltinCommandPresetName, ...] = tuple(builtin_command_presets)


def list_builtin_commands(selection: BuiltinCommandSelection | None = None) -> list[CommandSpec]:
    resolved = _resolve_builtin_selection(selection or BuiltinCommandSelection())
    excluded = set(resolved.exclude_commands)
    specs: list[CommandSpec] = []

    for group_name in _selected_group_names(resolved.include_groups):
        for spec in builtin_command_groups[group_name]:
            if spec.name not in excluded:
                specs.append(spec)

    return specs


def register_commands(
    registry: CommandRegistry,
    specs: Iterable[CommandSpec],
    *,
    on_conflict: RegisterConflictMode = "error",
) -> None:
    for spec in specs:
        if not registry.has(spec.name):
            registry.register(spec)
            continue

        if on_conflict == "skip":
            continue
        if on_conflict == "replace":
            registry.replace(spec)
            continue
        if on_conflict == "error":
            registry.register(spec)
            continue

        raise ValueError(f"unknown conflict mode: {on_conflict}")


def register_builtin_commands(
    registry: CommandRegistry,
    selection: BuiltinCommandSelection | None = None,
    *,
    on_conflict: RegisterConflictMode = "error",
) -> None:
    register_commands(registry, list_builtin_commands(selection), on_conflict=on_conflict)


def create_command_registry(
    options: CreateCommandRegistryOptions | None = None,
) -> CommandRegistry:
    resolved = options or CreateCommandRegistryOptions()
    registry = CommandRegistry()
    register_builtin_commands(registry, resolved)

    if resolved.commands:
        register_commands(
            registry,
            resolved.commands,
            on_conflict=resolved.on_conflict or "error",
        )

    return registry


def _resolve_builtin_selection(selection: BuiltinCommandSelection) -> BuiltinCommandSelection:
    preset_name = selection.preset or "full"
    base = _get_builtin_command_preset(preset_name)
    include_groups = selection.include_groups or base.include_groups or builtin_command_group_names
    exclude_commands = (*base.exclude_commands, *selection.exclude_commands)
    return BuiltinCommandSelection(
        preset=preset_name,
        include_groups=tuple(include_groups),
        exclude_commands=tuple(exclude_commands),
    )


def _get_builtin_command_preset(name: BuiltinCommandPresetName) -> BuiltinCommandSelection:
    if name not in builtin_command_presets:
        raise ValueError(f"unknown builtin command preset: {name}")
    return builtin_command_presets[name]


def _selected_group_names(
    include_groups: Sequence[BuiltinCommandGroupName] | None,
) -> tuple[BuiltinCommandGroupName, ...]:
    if include_groups is None:
        return builtin_command_group_names

    names: list[BuiltinCommandGroupName] = []
    seen: set[str] = set()
    for name in include_groups:
        if name not in builtin_command_groups:
            raise ValueError(f"unknown builtin command group: {name}")
        if name in seen:
            continue
        seen.add(name)
        names.append(name)

    return tuple(names)
