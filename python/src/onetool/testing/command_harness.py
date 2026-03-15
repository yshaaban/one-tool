from __future__ import annotations

from dataclasses import dataclass

from ..commands import CommandContext, CommandRegistry, CommandSpec, create_command_registry, maybe_await
from ..commands.register import CreateCommandRegistryOptions
from ..execution_policy import AgentCLIExecutionPolicy, resolve_execution_policy
from ..memory import SimpleMemory
from ..types import CommandResult, ToolAdapters
from ..vfs import VFS, MemoryVFS

NO_STDIN = b""


@dataclass(frozen=True, slots=True)
class CreateTestCommandContextOptions:
    vfs: VFS | None = None
    adapters: ToolAdapters | None = None
    memory: SimpleMemory | None = None
    registry: CommandRegistry | None = None
    execution_policy: AgentCLIExecutionPolicy | None = None
    output_dir: str | None = None
    output_counter: int | None = None


@dataclass(frozen=True, slots=True)
class RunRegisteredCommandOptions:
    ctx: CommandContext | None = None
    stdin: bytes = NO_STDIN


@dataclass(frozen=True, slots=True)
class RunRegisteredCommandResult:
    ctx: CommandContext
    result: CommandResult
    spec: CommandSpec


def create_test_command_registry(options: CreateCommandRegistryOptions | None = None) -> CommandRegistry:
    return create_command_registry(options)


def create_test_command_context(
    options: CreateTestCommandContextOptions | None = None,
) -> CommandContext:
    resolved = options or CreateTestCommandContextOptions()
    registry = resolved.registry or create_test_command_registry()
    execution_policy = resolve_execution_policy(resolved.execution_policy)

    return CommandContext(
        vfs=resolved.vfs or MemoryVFS(),
        adapters=resolved.adapters or ToolAdapters(),
        memory=resolved.memory or SimpleMemory(),
        registry=registry,
        execution_policy=execution_policy,
        output_dir=resolved.output_dir or "/output",
        output_counter=resolved.output_counter or 0,
    )


def get_registered_command(name: str, registry: CommandRegistry) -> CommandSpec:
    spec = registry.get(name)
    if spec is None:
        raise ValueError(f"expected command to exist: {name}")
    return spec


async def run_registered_command(
    name: str,
    args: list[str] | tuple[str, ...] | None = None,
    options: RunRegisteredCommandOptions | None = None,
) -> RunRegisteredCommandResult:
    resolved = options or RunRegisteredCommandOptions()
    ctx = resolved.ctx or create_test_command_context()
    spec = get_registered_command(name, ctx.registry)
    result = await maybe_await(spec.handler(ctx, list(args or ()), resolved.stdin))

    return RunRegisteredCommandResult(
        ctx=ctx,
        result=result,
        spec=spec,
    )


def stdout_text(result: CommandResult | bytes) -> str:
    data = result if isinstance(result, bytes) else result.stdout
    return data.decode("utf-8")


def stdin_text(text: str) -> bytes:
    return text.encode("utf-8")
