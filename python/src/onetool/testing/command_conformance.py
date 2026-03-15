from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
import re

from ..commands import CommandContext, CommandRegistry, CommandSpec, maybe_await
from ..types import CommandResult, ToolAdapters
from .command_harness import (
    NO_STDIN,
    CreateTestCommandContextOptions,
    create_test_command_context,
    get_registered_command,
    stdout_text,
)


@dataclass(frozen=True, slots=True)
class CommandConformanceOptions:
    registry: CommandRegistry
    make_ctx: Callable[[CreateTestCommandContextOptions | None], CommandContext]
    strict_metadata: bool = False
    rejection_stdin: bytes = b"unwanted"


@dataclass(frozen=True, slots=True)
class CommandConformanceCase:
    command_name: str
    name: str
    run: Callable[[], object]


def create_command_conformance_cases(options: CommandConformanceOptions) -> list[CommandConformanceCase]:
    cases: list[CommandConformanceCase] = []
    registry = options.registry

    for spec in registry.all():
        sample_args = list(spec.conformance_args)

        cases.append(
            _create_case(
                spec,
                "has valid spec metadata",
                lambda spec=spec, sample_args=sample_args: _assert_spec_metadata(
                    spec,
                    sample_args,
                    options.strict_metadata,
                ),
            )
        )
        cases.append(
            _create_case(
                spec,
                "representative call never throws",
                lambda spec=spec, sample_args=sample_args: _invoke_spec(options, spec, sample_args),
            )
        )
        cases.append(
            _create_case(
                spec,
                "error output references command name",
                lambda spec=spec: _assert_error_output_references_command(options, spec),
            )
        )

        if registry.has("help"):
            cases.append(
                _create_case(
                    spec,
                    "help entry exists",
                    lambda spec=spec: _assert_help_entry_exists(options, spec.name),
                )
            )

        if spec.accepts_stdin is False:
            cases.append(
                _create_case(
                    spec,
                    "rejects stdin",
                    lambda spec=spec, sample_args=sample_args: _assert_stdin_rejected(
                        options,
                        spec,
                        sample_args,
                    ),
                )
            )

        if (spec.min_args or 0) > 0:
            cases.append(
                _create_case(
                    spec,
                    f"requires at least {spec.min_args} arg(s)",
                    lambda spec=spec: _assert_too_few_args_rejected(options, spec),
                )
            )

        if spec.max_args is not None:
            cases.append(
                _create_case(
                    spec,
                    f"rejects more than {spec.max_args} arg(s)",
                    lambda spec=spec: _assert_too_many_args_rejected(options, spec),
                )
            )

        if spec.requires_adapter is not None:
            cases.append(
                _create_case(
                    spec,
                    f"reports missing {spec.requires_adapter} adapter",
                    lambda spec=spec, sample_args=sample_args: _assert_missing_adapter_rejected(
                        options,
                        spec,
                        sample_args,
                    ),
                )
            )

    return cases


def _create_case(spec: CommandSpec, name: str, run: Callable[[], object]) -> CommandConformanceCase:
    return CommandConformanceCase(
        command_name=spec.name,
        name=name,
        run=run,
    )


async def _assert_error_output_references_command(
    options: CommandConformanceOptions,
    spec: CommandSpec,
) -> None:
    result = await _invoke_spec(options, spec, [])
    if result.exit_code != 0:
        _assert_includes(
            result.stderr,
            spec.name,
            f'error output should reference "{spec.name}"',
        )


async def _assert_help_entry_exists(options: CommandConformanceOptions, command_name: str) -> None:
    ctx = options.make_ctx(CreateTestCommandContextOptions(registry=options.registry))
    help_spec = ctx.registry.get("help")
    if help_spec is None:
        raise ValueError("help command is not registered")
    result = await maybe_await(help_spec.handler(ctx, [command_name], NO_STDIN))
    _assert_equal(result.exit_code, 0, f"help {command_name} should exit successfully")
    _assert_includes(
        stdout_text(result),
        get_registered_command(command_name, options.registry).summary,
        f"help {command_name} should include the command summary",
    )


async def _assert_stdin_rejected(
    options: CommandConformanceOptions,
    spec: CommandSpec,
    sample_args: list[str],
) -> None:
    result = await _invoke_spec(options, spec, sample_args, options.rejection_stdin)
    _assert_equal(result.exit_code, 1, f"{spec.name} should reject stdin")
    _assert_match(result.stderr, r"does not accept stdin", f"{spec.name} should explain the stdin rejection")


async def _assert_too_few_args_rejected(options: CommandConformanceOptions, spec: CommandSpec) -> None:
    result = await _invoke_spec(options, spec, _too_few_args_for(spec))
    _assert_condition(result.exit_code != 0, f"{spec.name} should reject too few arguments")


async def _assert_too_many_args_rejected(options: CommandConformanceOptions, spec: CommandSpec) -> None:
    result = await _invoke_spec(options, spec, _too_many_args_for(spec))
    _assert_condition(result.exit_code != 0, f"{spec.name} should reject too many arguments")


async def _assert_missing_adapter_rejected(
    options: CommandConformanceOptions,
    spec: CommandSpec,
    sample_args: list[str],
) -> None:
    result = await _invoke_spec(
        options,
        spec,
        _adapter_args_for(spec, sample_args),
        ctx_options=CreateTestCommandContextOptions(
            registry=options.registry,
            adapters=ToolAdapters(),
        ),
    )
    _assert_equal(result.exit_code, 1, f"{spec.name} should reject missing adapters")
    _assert_match(
        result.stderr,
        rf"{re.escape(spec.name)}: no {re.escape(str(spec.requires_adapter))} adapter configured",
        f"{spec.name} should explain the missing adapter",
    )


async def _invoke_spec(
    options: CommandConformanceOptions,
    spec: CommandSpec,
    args: list[str],
    stdin: bytes = NO_STDIN,
    ctx_options: CreateTestCommandContextOptions | None = None,
) -> CommandResult:
    ctx = options.make_ctx(ctx_options or CreateTestCommandContextOptions(registry=options.registry))
    return await maybe_await(spec.handler(ctx, list(args), stdin))


def _assert_spec_metadata(spec: CommandSpec, sample_args: list[str], strict_metadata: bool) -> None:
    _assert_non_empty(spec.name, "command name")
    _assert_non_empty(spec.summary, f"{spec.name} summary")
    _assert_non_empty(spec.usage, f"{spec.name} usage")
    _assert_non_empty(spec.details, f"{spec.name} details")
    _assert_condition(callable(spec.handler), f"{spec.name} handler must be callable")

    if strict_metadata:
        _assert_condition(spec.accepts_stdin is not None, f"{spec.name} should declare accepts_stdin")
        _assert_condition(spec.min_args is not None, f"{spec.name} should declare min_args")
    elif spec.min_args is not None:
        _assert_condition(isinstance(spec.min_args, int), f"{spec.name} min_args must be numeric")

    if spec.accepts_stdin is not None:
        _assert_condition(isinstance(spec.accepts_stdin, bool), f"{spec.name} accepts_stdin must be boolean")
    if spec.max_args is not None:
        _assert_condition(isinstance(spec.max_args, int), f"{spec.name} max_args must be numeric")
        _assert_condition(spec.max_args >= (spec.min_args or 0), f"{spec.name} has max_args < min_args")
    if spec.min_args is not None:
        _assert_condition(len(sample_args) >= spec.min_args, f"{spec.name} conformance_args should satisfy min_args")
    if spec.max_args is not None:
        _assert_condition(len(sample_args) <= spec.max_args, f"{spec.name} conformance_args should satisfy max_args")


def _adapter_args_for(spec: CommandSpec, sample_args: list[str]) -> list[str]:
    if sample_args:
        return list(sample_args)
    count = max(spec.min_args or 0, 1)
    return [f"arg{index}" for index in range(count)]


def _too_few_args_for(spec: CommandSpec) -> list[str]:
    count = max((spec.min_args or 0) - 1, 0)
    return [f"arg{index}" for index in range(count)]


def _too_many_args_for(spec: CommandSpec) -> list[str]:
    count = (spec.max_args or 0) + 1
    return [f"arg{index}" for index in range(count)]


def _assert_condition(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _assert_equal(actual: object, expected: object, message: str) -> None:
    if actual != expected:
        raise AssertionError(f"{message}. Expected {expected!r}, got {actual!r}")


def _assert_includes(actual: str, expected: str, message: str) -> None:
    if expected not in actual:
        raise AssertionError(f'{message}. Expected "{actual}" to include "{expected}"')


def _assert_match(actual: str, pattern: str, message: str) -> None:
    if re.search(pattern, actual) is None:
        raise AssertionError(f'{message}. Expected "{actual}" to match /{pattern}/')


def _assert_non_empty(value: str, label: str) -> None:
    _assert_condition(value.strip() != "", f"{label} must be non-empty")
