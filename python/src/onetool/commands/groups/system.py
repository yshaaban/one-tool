from __future__ import annotations

from ...types import CommandResult, err, ok
from ..core import CommandContext, CommandSpec
from ..shared.io import render_help


async def cmd_help(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    if stdin:
        return err("help: does not accept stdin")

    if not args:
        lines = ["Available commands:"]
        for spec in ctx.registry.all():
            lines.append(f"  {spec.name.ljust(8, ' ')} — {spec.summary}")
        lines.extend(["", "Use: help <command>", "Or run a command with no args to get its usage."])
        return ok("\n".join(lines))

    if len(args) != 1:
        return err("help: usage: help [command]")

    spec = ctx.registry.get(args[0])
    if spec is None:
        return err(f"help: unknown command: {args[0]}\nAvailable: {', '.join(ctx.registry.names())}")

    return ok(render_help(spec))


help_command = CommandSpec(
    name="help",
    summary="List commands or show detailed help for one command.",
    usage="help [command]",
    details="Examples:\n  help\n  help grep\n  grep",
    handler=cmd_help,
    accepts_stdin=False,
    min_args=0,
    max_args=1,
    conformance_args=(),
)


async def cmd_memory(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    if not args:
        return err("memory: usage: memory search <query> | memory recent [N] | memory store <text>")

    subcommand = args[0]
    if subcommand == "store":
        if len(args) > 1:
            item = ctx.memory.store(" ".join(args[1:]))
            return ok(f"stored memory #{item.id}")
        if stdin:
            item = ctx.memory.store(stdin.decode("utf-8"))
            return ok(f"stored memory #{item.id}")
        return err("memory store: provide text inline or via stdin")

    if subcommand == "recent":
        if len(args) > 2:
            return err("memory recent: usage: memory recent [N]")
        limit = 10
        if len(args) == 2:
            try:
                limit = int(args[1], 10)
            except ValueError:
                return err(f"memory recent: invalid integer: {args[1]}")
        items = ctx.memory.recent(limit)
        if not items:
            return ok("(no memories)")
        return ok("\n".join(f"#{item.id}  {item.text}" for item in items))

    if subcommand == "search":
        if len(args) == 1 and not stdin:
            return err("memory search: usage: memory search <query>")
        query = " ".join(args[1:]) if len(args) > 1 else stdin.decode("utf-8")
        items = ctx.memory.search(query, 10)
        if not items:
            return ok("(no matches)")
        return ok("\n".join(f"#{item.id}  {item.text}" for item in items))

    return err("memory: unknown subcommand. Use: memory search | memory recent | memory store")


memory = CommandSpec(
    name="memory",
    summary="Search, store, or inspect lightweight runtime-scoped working memory.",
    usage="memory search <query> | memory recent [N] | memory store <text>",
    details=(
        "This is lightweight runtime memory for the current agent session. "
        "It is not file storage or semantic retrieval infrastructure.\n"
        "Examples:\n"
        '  memory store "Acme prefers Monday follow-ups"\n'
        '  memory search "Acme follow-up"\n'
        "  memory recent 5"
    ),
    handler=cmd_memory,
    accepts_stdin=True,
    min_args=1,
    conformance_args=("recent",),
)


system_commands = [help_command, memory]
