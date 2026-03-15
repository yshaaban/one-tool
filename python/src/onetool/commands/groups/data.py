from __future__ import annotations

import json

from ...types import CommandResult, err, ok
from ...utils import error_message, safe_eval_arithmetic
from ..core import CommandContext, CommandSpec
from ..shared.json import extract_json_path, load_json


async def cmd_json(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    if not args:
        return err("json: usage: json pretty [path] | json keys [path] | json get <field.path> [path]")

    subcommand = args[0]
    if subcommand == "pretty":
        if len(args) > 2:
            return err("json: usage: json pretty [path]")
        loaded = await load_json(ctx, args[1] if len(args) > 1 else None, stdin, "json pretty")
        if loaded.error is not None:
            return loaded.error
        return ok(json.dumps(loaded.value, indent=2), content_type="application/json")

    if subcommand == "keys":
        if len(args) > 2:
            return err("json: usage: json keys [path]")
        loaded = await load_json(ctx, args[1] if len(args) > 1 else None, stdin, "json keys")
        if loaded.error is not None:
            return loaded.error
        if not isinstance(loaded.value, dict):
            return err("json keys: input must be a JSON object")
        return ok("\n".join(sorted(loaded.value)))

    if subcommand == "get":
        if len(args) < 2 or len(args) > 3:
            return err("json: usage: json get <field.path> [path]")

        loaded = await load_json(ctx, args[2] if len(args) > 2 else None, stdin, "json get")
        if loaded.error is not None:
            return loaded.error

        path_expression = args[1]
        try:
            extracted = extract_json_path(loaded.value, path_expression)
        except Exception as caught:
            return err(f"json get: path not found: {path_expression} ({error_message(caught)})")

        if isinstance(extracted, (dict, list)):
            return ok(json.dumps(extracted, indent=2), content_type="application/json")
        return ok(str(extracted))

    return err("json: unknown subcommand. Use: json pretty | json keys | json get")


json_command = CommandSpec(
    name="json",
    summary="Inspect JSON from stdin or a file: pretty, keys, get.",
    usage="json pretty [path] | json keys [path] | json get <field.path> [path]",
    details=(
        "Uses a small dot-and-index path syntax such as customer.email or items[0].id. "
        "It is not jq.\n"
        "Examples:\n"
        "  fetch order:123 | json pretty\n"
        "  fetch order:123 | json get customer.email\n"
        "  json keys /config/default.json"
    ),
    handler=cmd_json,
    accepts_stdin=True,
    min_args=1,
    conformance_args=("pretty",),
)


async def cmd_calc(_ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    if stdin:
        return err("calc: does not accept stdin")
    if not args:
        return err("calc: usage: calc <expression>")

    try:
        value = safe_eval_arithmetic(" ".join(args))
    except Exception as caught:
        return err(f"calc: invalid expression: {error_message(caught)}")

    if value.is_integer():
        return ok(str(int(value)))
    return ok(str(value))


calc = CommandSpec(
    name="calc",
    summary="Evaluate a safe arithmetic expression.",
    usage="calc <expression>",
    details=(
        "Supports numbers, parentheses, and the operators +, -, *, /, and %.\n"
        "Examples:\n"
        "  calc 41 + 1\n"
        "  calc (12 * 8) / 3"
    ),
    handler=cmd_calc,
    accepts_stdin=False,
    min_args=1,
    conformance_args=("1+1",),
)


data_commands = [json_command, calc]
