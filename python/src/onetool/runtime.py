from __future__ import annotations

import importlib
import time
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Literal, cast

from .commands.core import CommandContext, CommandHandler, CommandRegistry, CommandSpec, maybe_await
from .commands.groups.adapters import adapter_commands
from .commands.groups.data import data_commands
from .commands.groups.system import system_commands
from .execution_policy import AgentCLIExecutionPolicy, resolve_execution_policy
from .memory import SimpleMemory
from .parser import ChainNode, ParseError, PipelineNode, parse_command_line
from .types import CommandResult, ToolAdapters, err, ok
from .utils import error_message, format_duration, format_size, looks_binary, split_lines
from .vfs.errors import to_vfs_error
from .vfs.interface import VFS

ToolDescriptionVariant = Literal["full-tool-description", "minimal-tool-description", "terse"]
PipelineSkippedReason = Literal["previous_failed", "previous_succeeded"]
PresentationStdoutMode = Literal["plain", "truncated", "binary-guard"]
BuiltinCommandGroupName = Literal["system", "adapters", "data"]
ChainRelation = Literal["&&", "||", ";"] | None

_SUPPORTED_BUILTIN_GROUPS: dict[BuiltinCommandGroupName, tuple[CommandSpec, ...]] = {
    "system": tuple(system_commands),
    "adapters": tuple(adapter_commands),
    "data": tuple(data_commands),
}
_SUPPORTED_BUILTIN_PRESETS: dict[str, dict[str, tuple[str, ...]]] = {
    "dataOnly": {
        "include_groups": ("system", "adapters", "data"),
        "exclude_commands": ("memory",),
    },
}


@dataclass(frozen=True, slots=True)
class AgentCLIOutputLimits:
    max_lines: int | None = None
    max_bytes: int | None = None


@dataclass(frozen=True, slots=True)
class CommandExecutionTrace:
    argv: list[str]
    stdin_bytes: int
    stdout_bytes: int
    stderr: str
    exit_code: int
    duration_ms: int
    content_type: str


@dataclass(frozen=True, slots=True)
class PipelineExecutionTrace:
    relation_from_previous: ChainRelation
    executed: bool
    commands: list[CommandExecutionTrace]
    skipped_reason: PipelineSkippedReason | None = None
    exit_code: int | None = None


@dataclass(frozen=True, slots=True)
class RunPresentation:
    text: str
    body: str
    stdout_mode: PresentationStdoutMode
    saved_path: str | None = None
    total_bytes: int | None = None
    total_lines: int | None = None


@dataclass(frozen=True, slots=True)
class RunExecution:
    command_line: str
    exit_code: int
    duration_ms: int
    stdout: bytes
    stderr: str
    content_type: str
    trace: list[PipelineExecutionTrace]
    presentation: RunPresentation


@dataclass(frozen=True, slots=True)
class BuiltinCommandSelection:
    preset: str | None = None
    include_groups: tuple[str, ...] | None = None
    exclude_commands: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class _ChainExecutionResult:
    result: CommandResult
    trace: list[PipelineExecutionTrace]


@dataclass(frozen=True, slots=True)
class _PipelineExecutionResult:
    result: CommandResult
    trace: PipelineExecutionTrace


@dataclass(frozen=True, slots=True)
class _RenderedStdout:
    text: str
    stdout_mode: PresentationStdoutMode
    saved_path: str | None = None
    total_bytes: int | None = None
    total_lines: int | None = None


@dataclass(frozen=True, slots=True)
class _OverflowArtifactResult:
    saved_path: str | None = None
    failure_message: str | None = None


class AgentCLI:
    def __init__(
        self,
        *,
        vfs: VFS,
        adapters: ToolAdapters | None = None,
        memory: SimpleMemory | None = None,
        registry: CommandRegistry | None = None,
        builtin_commands: BuiltinCommandSelection | Mapping[str, object] | bool | None = None,
        commands: Iterable[CommandSpec] | None = None,
        output_limits: AgentCLIOutputLimits | Mapping[str, object] | None = None,
        execution_policy: AgentCLIExecutionPolicy | None = None,
    ) -> None:
        self.registry = _resolve_registry(
            registry=registry,
            builtin_commands=builtin_commands,
            commands=commands,
        )
        self._output_limits = _resolve_output_limits(output_limits)
        resolved_execution_policy = resolve_execution_policy(execution_policy)
        self.ctx = CommandContext(
            vfs=vfs,
            adapters=adapters or ToolAdapters(),
            memory=memory or SimpleMemory(),
            registry=self.registry,
            execution_policy=resolved_execution_policy,
            output_dir="/.system/cmd-output",
            output_counter=0,
        )

    async def initialize(self) -> None:
        await self.ctx.vfs.mkdir(self.ctx.output_dir, True)

    def build_tool_description(
        self,
        variant: ToolDescriptionVariant = "full-tool-description",
    ) -> str:
        commands = self.registry.all()
        has_help = self.registry.has("help")

        if not commands:
            return _build_empty_tool_description()

        if variant == "minimal-tool-description":
            return _build_minimal_tool_description(commands, has_help)
        if variant == "terse":
            return _build_terse_tool_description(commands, has_help)
        if variant == "full-tool-description":
            return _build_full_tool_description(commands, has_help)

        raise ValueError(f"unknown tool description variant: {variant}")

    async def run(self, command_line: str) -> str:
        execution = await self.run_detailed(command_line)
        return execution.presentation.text

    async def run_detailed(self, command_line: str) -> RunExecution:
        started = time.perf_counter()

        try:
            chain = parse_command_line(command_line)
            execution = await self._execute_chain(chain)
            return await self._finalize_run_execution(
                command_line,
                execution.result,
                execution.trace,
                started,
            )
        except ParseError as caught:
            return await self._finalize_run_execution(
                command_line,
                err(str(caught), exit_code=2),
                [],
                started,
            )
        except Exception as caught:
            return await self._finalize_run_execution(
                command_line,
                err(f"internal runtime error: {error_message(caught)}", exit_code=1),
                [],
                started,
            )

    async def _execute_chain(self, chain: list[ChainNode]) -> _ChainExecutionResult:
        aggregate = bytearray()
        last_result = ok("")
        trace: list[PipelineExecutionTrace] = []

        for item in chain:
            skipped_reason = _get_pipeline_skipped_reason(
                cast(ChainRelation, item.relation_from_previous),
                last_result.exit_code,
            )
            if skipped_reason is not None:
                trace.append(
                    PipelineExecutionTrace(
                        relation_from_previous=cast(ChainRelation, item.relation_from_previous),
                        executed=False,
                        skipped_reason=skipped_reason,
                        commands=[],
                    )
                )
                continue

            pipeline_result = await self._execute_pipeline(
                item.pipeline,
                cast(ChainRelation, item.relation_from_previous),
            )
            trace.append(pipeline_result.trace)

            if pipeline_result.result.stdout:
                if aggregate and aggregate[-1] != 10 and pipeline_result.result.stdout[0] != 10:
                    aggregate.append(10)
                aggregate.extend(pipeline_result.result.stdout)

            last_result = pipeline_result.result

        return _ChainExecutionResult(
            result=CommandResult(
                stdout=bytes(aggregate),
                stderr=last_result.stderr,
                exit_code=last_result.exit_code,
                content_type=last_result.content_type,
            ),
            trace=trace,
        )

    async def _execute_pipeline(
        self,
        pipeline: PipelineNode,
        relation_from_previous: ChainRelation,
    ) -> _PipelineExecutionResult:
        current_stdin = b""
        last_result = ok("")
        command_trace: list[CommandExecutionTrace] = []

        for node in pipeline.commands:
            if not node.argv:
                last_result = err("empty command in pipeline", exit_code=2)
                command_trace.append(
                    CommandExecutionTrace(
                        argv=[],
                        stdin_bytes=len(current_stdin),
                        stdout_bytes=0,
                        stderr=last_result.stderr,
                        exit_code=last_result.exit_code,
                        duration_ms=0,
                        content_type=last_result.content_type,
                    )
                )
                break

            started = time.perf_counter()
            last_result = await self._dispatch(node.argv, current_stdin)
            command_trace.append(
                CommandExecutionTrace(
                    argv=list(node.argv),
                    stdin_bytes=len(current_stdin),
                    stdout_bytes=len(last_result.stdout),
                    stderr=last_result.stderr,
                    exit_code=last_result.exit_code,
                    duration_ms=max(0, round((time.perf_counter() - started) * 1000)),
                    content_type=last_result.content_type,
                )
            )

            if last_result.exit_code != 0:
                break

            current_stdin = bytes(last_result.stdout)

        return _PipelineExecutionResult(
            result=last_result,
            trace=PipelineExecutionTrace(
                relation_from_previous=relation_from_previous,
                executed=True,
                commands=command_trace,
                exit_code=last_result.exit_code,
            ),
        )

    async def _dispatch(self, argv: list[str], stdin: bytes) -> CommandResult:
        spec = self.registry.get(argv[0])
        if spec is None:
            available = self.registry.names()
            available_text = ", ".join(available) if available else "(none)"
            return err(
                f"unknown command: {argv[0]}\nAvailable: {available_text}",
                exit_code=127,
            )

        return await maybe_await(spec.handler(self.ctx, argv[1:], stdin))

    async def _finalize_run_execution(
        self,
        command_line: str,
        result: CommandResult,
        trace: list[PipelineExecutionTrace],
        started: float,
    ) -> RunExecution:
        duration_ms = max(0, round((time.perf_counter() - started) * 1000))
        presentation = await self._present(result, duration_ms)

        return RunExecution(
            command_line=command_line,
            exit_code=result.exit_code,
            duration_ms=duration_ms,
            stdout=bytes(result.stdout),
            stderr=result.stderr,
            content_type=result.content_type,
            trace=trace,
            presentation=presentation,
        )

    async def _present(self, result: CommandResult, duration_ms: int) -> RunPresentation:
        parts: list[str] = []
        stdout_mode: PresentationStdoutMode = "plain"
        saved_path: str | None = None
        total_bytes: int | None = None
        total_lines: int | None = None

        if result.stdout:
            if looks_binary(result.stdout):
                stdout_mode = "binary-guard"
                total_bytes = len(result.stdout)
                saved = await self._store_overflow_bytes(result.stdout, ".bin")
                if saved.saved_path is not None:
                    saved_path = saved.saved_path
                    parts.append(
                        "[error] command produced binary output that should not be sent to the model.\n"
                        f"Saved to: {saved.saved_path}\n"
                        f"Use: stat {saved.saved_path}"
                    )
                else:
                    parts.append(
                        "[error] command produced binary output that should not be sent to the model.\n"
                        f"{saved.failure_message or 'Binary output could not be saved.'}"
                    )
            else:
                rendered = await self._apply_overflow(result.stdout.decode("utf-8"))
                stdout_mode = rendered.stdout_mode
                saved_path = rendered.saved_path
                total_bytes = rendered.total_bytes
                total_lines = rendered.total_lines
                if rendered.text.strip():
                    parts.append(rendered.text.rstrip())

        stderr_text = result.stderr.strip()
        if result.exit_code != 0 and stderr_text:
            parts.append(f"[error] {stderr_text}")
        elif stderr_text:
            parts.append(f"[stderr] {stderr_text}")

        body = "\n\n".join(parts)
        footer = f"[exit:{result.exit_code} | {format_duration(duration_ms)}]"
        text = f"{body}\n\n{footer}" if body else footer

        return RunPresentation(
            text=text,
            body=body,
            stdout_mode=stdout_mode,
            saved_path=saved_path,
            total_bytes=total_bytes,
            total_lines=total_lines,
        )

    async def _apply_overflow(self, text: str) -> _RenderedStdout:
        encoded = text.encode("utf-8")
        lines = split_lines(text)

        if len(lines) <= self._output_limits.max_lines and len(encoded) <= self._output_limits.max_bytes:
            return _RenderedStdout(text=text, stdout_mode="plain")

        saved = await self._store_overflow_text(text)
        preview = "\n".join(lines[: self._output_limits.max_lines])

        while preview and len(preview.encode("utf-8")) > self._output_limits.max_bytes:
            preview = preview[:-1]

        meta_lines = [f"--- output truncated ({len(lines)} lines, {format_size(len(encoded))}) ---"]
        if saved.saved_path is not None:
            meta_lines.extend(
                (
                    f"Full output: {saved.saved_path}",
                    f"Explore: cat {saved.saved_path} | grep <pattern>",
                    f"         cat {saved.saved_path} | tail -n 100",
                )
            )
        else:
            meta_lines.append(saved.failure_message or "Full output could not be saved.")

        meta = "\n".join(meta_lines)
        if preview:
            rendered = f"{preview}\n\n{meta}"
        else:
            rendered = meta

        return _RenderedStdout(
            text=rendered,
            stdout_mode="truncated",
            saved_path=saved.saved_path,
            total_bytes=len(encoded),
            total_lines=len(lines),
        )

    async def _store_overflow_text(self, text: str) -> _OverflowArtifactResult:
        self.ctx.output_counter += 1
        target = f"{self.ctx.output_dir}/cmd-{self.ctx.output_counter:04d}.txt"
        return await self._store_overflow_artifact(target, text.encode("utf-8"))

    async def _store_overflow_bytes(
        self,
        data: bytes,
        suffix: str = ".bin",
    ) -> _OverflowArtifactResult:
        self.ctx.output_counter += 1
        target = f"{self.ctx.output_dir}/cmd-{self.ctx.output_counter:04d}{suffix}"
        return await self._store_overflow_artifact(target, data)

    async def _store_overflow_artifact(
        self,
        path: str,
        data: bytes,
    ) -> _OverflowArtifactResult:
        try:
            await self.ctx.vfs.write_bytes(path, data)
            return _OverflowArtifactResult(saved_path=path)
        except Exception as caught:
            return _OverflowArtifactResult(
                failure_message=self._describe_overflow_artifact_failure(caught)
            )

    def _describe_overflow_artifact_failure(self, caught: object) -> str:
        resolved = to_vfs_error(caught)
        if resolved is not None and resolved.code == "ERESOURCE_LIMIT":
            details = resolved.details or {}
            limit_kind = details.get("limitKind")
            limit = details.get("limit")
            actual = details.get("actual")
            if isinstance(limit_kind, str):
                if isinstance(limit, int) and isinstance(actual, int):
                    return (
                        "Full output could not be saved because "
                        f"{limit_kind} was exceeded ({actual} > {limit})."
                    )
                return f"Full output could not be saved because {limit_kind} was exceeded."

        return f"Full output could not be saved: {error_message(caught)}"


async def create_agent_cli(**options: object) -> AgentCLI:
    runtime = AgentCLI(**options)
    await runtime.initialize()
    return runtime


def _build_full_tool_description(commands: list[CommandSpec], has_help: bool) -> str:
    lines = [*_build_description_header(), "", "Available commands:"]
    for spec in commands:
        lines.append(f"  {spec.name.ljust(8, ' ')} — {spec.summary}")
    lines.extend(("", *_build_discovery_lines(has_help)))
    return "\n".join(lines)


def _build_minimal_tool_description(commands: list[CommandSpec], has_help: bool) -> str:
    lines = _build_description_header()
    lines.extend(("", "Command discovery:"))

    if has_help:
        lines.append("  - run 'help' to list commands")
    else:
        lines.append("  - available command names:")
        for spec in commands:
            lines.append(f"      {spec.name}")

    lines.extend(
        (
            "  - run '<command>' with no args for usage",
            "  - use pipes for composition",
        )
    )
    if has_help:
        lines.append("  - detailed command catalog omitted in this variant")

    return "\n".join(lines)


def _build_terse_tool_description(commands: list[CommandSpec], has_help: bool) -> str:
    lines = _build_description_header()
    lines.extend(("", "Available commands:"))
    for spec in commands:
        lines.append(f"  {spec.name}")
    lines.extend(("", *_build_discovery_lines(has_help)))
    return "\n".join(lines)


def _build_empty_tool_description() -> str:
    lines = _build_description_header()
    lines.extend(
        (
            "",
            "Available commands:",
            "  (no commands registered)",
            "",
            "Register built-in or custom commands before exposing the run tool.",
        )
    )
    return "\n".join(lines)


def _build_description_header() -> list[str]:
    return [
        "Run CLI-style commands over registered tools and a rooted virtual file system.",
        "This is not a real shell. Only registered commands are allowed.",
        "Supported operators: |  &&  ||  ;",
        "No env expansion, no globbing, no command substitution, no redirection.",
        "Paths are rooted to '/'. Relative paths also resolve under '/'.",
    ]


def _build_discovery_lines(has_help: bool) -> list[str]:
    lines = ["Discovery pattern:"]
    if has_help:
        lines.append("  - run 'help' to list commands")
    lines.extend(
        (
            "  - run '<command>' with no args for usage",
            "  - use pipes for composition",
        )
    )
    return lines


def _get_pipeline_skipped_reason(
    relation: ChainRelation,
    previous_exit_code: int,
) -> PipelineSkippedReason | None:
    if relation == "&&" and previous_exit_code != 0:
        return "previous_failed"
    if relation == "||" and previous_exit_code == 0:
        return "previous_succeeded"
    return None


def _resolve_registry(
    *,
    registry: CommandRegistry | None,
    builtin_commands: BuiltinCommandSelection | Mapping[str, object] | bool | None,
    commands: Iterable[CommandSpec] | None,
) -> CommandRegistry:
    if registry is not None:
        if builtin_commands is not None:
            raise ValueError("AgentCLI.registry cannot be combined with builtin_commands")
        if commands is not None:
            raise ValueError("AgentCLI.registry cannot be combined with commands")
        return registry

    selection = _coerce_builtin_selection(builtin_commands)
    if builtin_commands is False:
        resolved_registry = CommandRegistry()
        _register_command_specs(resolved_registry, commands or (), on_conflict="replace")
        return resolved_registry

    registry_module = _load_register_module()
    if registry_module is not None:
        return _resolve_registry_via_module(registry_module, selection, commands)

    return _resolve_registry_via_fallback(selection, commands)


def _resolve_output_limits(
    output_limits: AgentCLIOutputLimits | Mapping[str, object] | None,
) -> AgentCLIOutputLimits:
    if output_limits is None:
        resolved = AgentCLIOutputLimits(max_lines=200, max_bytes=50 * 1024)
    elif isinstance(output_limits, AgentCLIOutputLimits):
        resolved = AgentCLIOutputLimits(
            max_lines=output_limits.max_lines,
            max_bytes=output_limits.max_bytes,
        )
    elif isinstance(output_limits, Mapping):
        resolved = AgentCLIOutputLimits(
            max_lines=_coerce_optional_int(output_limits, "max_lines", "maxLines"),
            max_bytes=_coerce_optional_int(output_limits, "max_bytes", "maxBytes"),
        )
    else:
        raise TypeError("output_limits must be an AgentCLIOutputLimits, mapping, or None")

    max_lines = 200 if resolved.max_lines is None else resolved.max_lines
    max_bytes = 50 * 1024 if resolved.max_bytes is None else resolved.max_bytes
    _assert_non_negative_int(max_lines, "output_limits.max_lines")
    _assert_non_negative_int(max_bytes, "output_limits.max_bytes")
    return AgentCLIOutputLimits(max_lines=max_lines, max_bytes=max_bytes)


def _coerce_builtin_selection(
    selection: BuiltinCommandSelection | Mapping[str, object] | bool | None,
) -> BuiltinCommandSelection:
    if selection is None or selection is True or selection is False:
        return BuiltinCommandSelection()

    if isinstance(selection, BuiltinCommandSelection):
        return selection

    if isinstance(selection, Mapping):
        preset = _coerce_optional_str(selection, "preset")
        include_groups = _coerce_optional_str_tuple(selection, "include_groups", "includeGroups")
        exclude_commands = _coerce_optional_str_tuple(
            selection,
            "exclude_commands",
            "excludeCommands",
        )
        return BuiltinCommandSelection(
            preset=preset,
            include_groups=include_groups,
            exclude_commands=exclude_commands or (),
        )

    preset = getattr(selection, "preset", None)
    include_groups = getattr(selection, "include_groups", getattr(selection, "includeGroups", None))
    exclude_commands = getattr(
        selection,
        "exclude_commands",
        getattr(selection, "excludeCommands", ()),
    )
    return BuiltinCommandSelection(
        preset=cast(str | None, preset) if preset is None or isinstance(preset, str) else None,
        include_groups=_tuple_or_none(include_groups),
        exclude_commands=_tuple_or_none(exclude_commands) or (),
    )


def _load_register_module() -> object | None:
    try:
        return importlib.import_module("onetool.commands.register")
    except Exception:
        return None


def _resolve_registry_via_module(
    registry_module: object,
    selection: BuiltinCommandSelection,
    commands: Iterable[CommandSpec] | None,
) -> CommandRegistry:
    options_type = getattr(registry_module, "CreateCommandRegistryOptions", None)
    create_registry = getattr(registry_module, "create_command_registry", None)

    if options_type is None or create_registry is None:
        raise RuntimeError("onetool.commands.register does not expose the expected registry helpers")

    options = options_type(
        preset=selection.preset,
        include_groups=selection.include_groups,
        exclude_commands=selection.exclude_commands,
        commands=tuple(commands or ()),
        on_conflict="replace",
    )
    return cast(CommandRegistry, create_registry(options))


def _resolve_registry_via_fallback(
    selection: BuiltinCommandSelection,
    commands: Iterable[CommandSpec] | None,
) -> CommandRegistry:
    resolved = _resolve_fallback_builtin_selection(selection)
    registry = CommandRegistry()

    for group_name in resolved.include_groups or ():
        for spec in _SUPPORTED_BUILTIN_GROUPS[cast(BuiltinCommandGroupName, group_name)]:
            if spec.name not in resolved.exclude_commands:
                _register_one(registry, spec, on_conflict="error")

    _register_command_specs(registry, commands or (), on_conflict="replace")
    return registry


def _resolve_fallback_builtin_selection(
    selection: BuiltinCommandSelection,
) -> BuiltinCommandSelection:
    preset_name = selection.preset or "full"
    if preset_name == "full":
        if selection.include_groups is None:
            raise RuntimeError(
                "Python built-in command registration is incomplete: the default full builtin "
                "selection requires fs/text command groups that are not ported yet. "
                "Pass builtin_commands=False, provide an explicit registry, or request only "
                "currently ported groups: system, adapters, data."
            )
        base = BuiltinCommandSelection()
    else:
        preset = _SUPPORTED_BUILTIN_PRESETS.get(preset_name)
        if preset is None:
            raise RuntimeError(
                "Python built-in command registration is incomplete: unsupported preset "
                f"{preset_name!r}. Currently supported presets: {', '.join(sorted(_SUPPORTED_BUILTIN_PRESETS))}."
            )
        base = BuiltinCommandSelection(
            preset=preset_name,
            include_groups=tuple(preset["include_groups"]),
            exclude_commands=tuple(preset["exclude_commands"]),
        )

    include_groups = selection.include_groups or base.include_groups
    if include_groups is None:
        raise RuntimeError("builtin command include_groups must be provided for the fallback registry")

    unsupported_groups = sorted(set(include_groups) - set(_SUPPORTED_BUILTIN_GROUPS))
    if unsupported_groups:
        raise RuntimeError(
            "Python built-in command registration is incomplete: unsupported builtin groups "
            f"{', '.join(unsupported_groups)} are not ported yet. Available groups: "
            f"{', '.join(sorted(_SUPPORTED_BUILTIN_GROUPS))}."
        )

    exclude_commands = (*base.exclude_commands, *selection.exclude_commands)
    return BuiltinCommandSelection(
        preset=selection.preset or base.preset or "partial",
        include_groups=tuple(include_groups),
        exclude_commands=tuple(exclude_commands),
    )


def _register_command_specs(
    registry: CommandRegistry,
    specs: Iterable[CommandSpec],
    *,
    on_conflict: Literal["error", "replace", "skip"],
) -> None:
    for spec in specs:
        _register_one(registry, spec, on_conflict=on_conflict)


def _register_one(
    registry: CommandRegistry,
    spec: CommandSpec,
    *,
    on_conflict: Literal["error", "replace", "skip"],
) -> None:
    if not registry.has(spec.name):
        registry.register(spec)
        return

    if on_conflict == "skip":
        return
    if on_conflict == "replace":
        registry.replace(spec)
        return
    if on_conflict == "error":
        registry.register(spec)
        return

    raise ValueError(f"unknown conflict mode: {on_conflict}")


def _coerce_optional_int(mapping: Mapping[str, object], *keys: str) -> int | None:
    value = _mapping_value(mapping, *keys)
    if value is None:
        return None
    if not isinstance(value, int):
        raise TypeError(f"{keys[0]} must be an integer")
    return value


def _coerce_optional_str(mapping: Mapping[str, object], *keys: str) -> str | None:
    value = _mapping_value(mapping, *keys)
    if value is None:
        return None
    if not isinstance(value, str):
        raise TypeError(f"{keys[0]} must be a string")
    return value


def _coerce_optional_str_tuple(
    mapping: Mapping[str, object],
    *keys: str,
) -> tuple[str, ...] | None:
    value = _mapping_value(mapping, *keys)
    return _tuple_or_none(value)


def _tuple_or_none(value: object) -> tuple[str, ...] | None:
    if value is None:
        return None
    if isinstance(value, str):
        raise TypeError("expected an iterable of strings, got a string")
    items = tuple(value)
    if any(not isinstance(item, str) for item in items):
        raise TypeError("expected an iterable of strings")
    return cast(tuple[str, ...], items)


def _mapping_value(mapping: Mapping[str, object], *keys: str) -> object | None:
    for key in keys:
        if key in mapping:
            return mapping[key]
    return None


def _assert_non_negative_int(value: int, label: str) -> None:
    if not isinstance(value, int) or value < 0:
        raise ValueError(f"{label} must be a non-negative integer")


__all__ = [
    "AgentCLI",
    "AgentCLIOutputLimits",
    "BuiltinCommandSelection",
    "CommandContext",
    "CommandExecutionTrace",
    "CommandHandler",
    "CommandRegistry",
    "CommandSpec",
    "PipelineExecutionTrace",
    "PipelineSkippedReason",
    "PresentationStdoutMode",
    "RunExecution",
    "RunPresentation",
    "ToolDescriptionVariant",
    "create_agent_cli",
]
