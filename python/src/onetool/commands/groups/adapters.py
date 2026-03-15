from __future__ import annotations

from ...types import CommandResult, err, ok, ok_bytes
from ...utils import error_message
from ..core import CommandContext, CommandSpec, maybe_await
from ..shared.errors import error_code_raw
from ..shared.io import materialized_limit_error
from ..shared.json import render_fetch_payload


def _configured_adapter_message(command_name: str) -> str:
    return (
        f"{command_name}: no {command_name} adapter configured. Pass "
        f"{{ adapters: {{ {command_name}: ... }} }} to createAgentCLI(...) to use this command."
    )


def _error_status_code(caught: object) -> int | None:
    status = getattr(caught, "status", None)
    if isinstance(status, int):
        return status
    status_code = getattr(caught, "statusCode", None)
    if isinstance(status_code, int):
        return status_code
    return None


def _is_fetch_not_found_error(caught: object) -> bool:
    code = error_code_raw(caught)
    if code in {"ENOENT", "NOT_FOUND"}:
        return True
    if _error_status_code(caught) == 404:
        return True
    return "not found" in error_message(caught).lower()


async def cmd_search(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    if stdin:
        return err("search: does not accept stdin")
    if not args:
        return err("search: usage: search <query>")
    if ctx.adapters.search is None:
        return err(_configured_adapter_message("search"))

    try:
        hits = await maybe_await(ctx.adapters.search.search(" ".join(args), 10))
    except Exception as caught:
        return err(f"search: adapter error: {error_message(caught)}")

    if not hits:
        return ok("(no results)")

    blocks: list[str] = []
    for index, hit in enumerate(hits, start=1):
        lines = [f"{index}. {hit.title}"]
        if hit.source:
            lines.append(f"   source: {hit.source}")
        if hit.snippet:
            lines.append(f"   {hit.snippet}")
        blocks.append("\n".join(lines))

    rendered = "\n\n".join(blocks)
    rendered_bytes = rendered.encode("utf-8")
    limit_error = materialized_limit_error(ctx, "search", "search results", len(rendered_bytes))
    if limit_error is not None:
        return limit_error

    return ok_bytes(rendered_bytes, "text/plain")


search = CommandSpec(
    name="search",
    summary="Query your configured search tool and return text results.",
    usage="search <query>",
    details=(
        "Ranking and recall come from the configured adapter. This command formats the top results "
        "for the runtime.\n"
        "Examples:\n"
        '  search "refund timeout incident"\n'
        '  search "acme renewal risk" | head -n 5'
    ),
    handler=cmd_search,
    accepts_stdin=False,
    min_args=1,
    requires_adapter="search",
    conformance_args=("query",),
)


async def cmd_fetch(ctx: CommandContext, args: list[str], stdin: bytes) -> CommandResult:
    if stdin:
        return err("fetch: does not accept stdin")
    if len(args) != 1:
        return err("fetch: usage: fetch <resource>")
    if ctx.adapters.fetch is None:
        return err(_configured_adapter_message("fetch"))

    try:
        response = await maybe_await(ctx.adapters.fetch.fetch(args[0]))
    except Exception as caught:
        if _is_fetch_not_found_error(caught):
            return err(f"fetch: resource not found: {args[0]}")
        return err(f"fetch: adapter error: {error_message(caught)}")

    return render_fetch_payload(
        response.payload,
        response.content_type,
        command_name="fetch",
        subject=args[0],
        max_materialized_bytes=ctx.execution_policy.max_materialized_bytes,
    )


fetch = CommandSpec(
    name="fetch",
    summary="Call your configured fetch tool and return text or JSON.",
    usage="fetch <resource>",
    details=(
        "Resource identifiers and payloads come from the configured adapter. "
        "This command renders the returned text, JSON, or bytes for the runtime.\n"
        "Examples:\n"
        "  fetch order:123\n"
        "  fetch crm/customer/acme | json get owner.email"
    ),
    handler=cmd_fetch,
    accepts_stdin=False,
    min_args=1,
    max_args=1,
    requires_adapter="fetch",
    conformance_args=("res:1",),
)


adapter_commands = [search, fetch]
