from __future__ import annotations

import pytest
from onetool.commands.core import CommandRegistry, CommandSpec
from onetool.types import ok

from onetool.testing import (
    NO_STDIN,
    AssertionSpec,
    CommandConformanceOptions,
    DemoSearch,
    DemoSearchDocument,
    FileAssertionSpec,
    MemoryAssertionSpec,
    OracleCommandSpec,
    ScenarioSpec,
    TextAssertionSpec,
    TraceAssertionSpec,
    TraceStepAssertionSpec,
    WorldSpec,
    assert_scenario,
    build_demo_runtime,
    build_world,
    create_command_conformance_cases,
    create_test_command_context,
    create_test_command_registry,
    get_registered_command,
    run_oracle,
    run_registered_command,
    stdin_text,
    stdout_text,
)


@pytest.mark.asyncio
async def test_demo_search_ranks_hits_and_truncates_snippets() -> None:
    docs = [
        DemoSearchDocument(
            title="Acme renewal risk notes",
            body="Acme renewal needs a weekly summary and invoice mapping help.",
            source="kb://accounts/acme",
        ),
        DemoSearchDocument(
            title="Incident retro",
            body="Timeout storm affected orders and invoices.",
            source="kb://incidents/refund-timeout",
        ),
    ]
    search = DemoSearch(docs)

    hits = await search.search("Acme invoice renewal", 10)

    assert hits[0].title == "Acme renewal risk notes"
    assert hits[0].source == "kb://accounts/acme"
    assert len(hits[0].snippet) <= 160


@pytest.mark.asyncio
async def test_demo_search_uses_c_locale_order_for_tied_non_ascii_titles() -> None:
    docs = [
        DemoSearchDocument(title="ä title", body="refund issue", source="kb://1"),
        DemoSearchDocument(title="z title", body="refund issue", source="kb://2"),
        DemoSearchDocument(title="a title", body="refund issue", source="kb://3"),
        DemoSearchDocument(title="É title", body="refund issue", source="kb://4"),
        DemoSearchDocument(title="Ω title", body="refund issue", source="kb://5"),
    ]
    search = DemoSearch(docs)

    hits = await search.search("refund", 10)

    assert [hit.title for hit in hits] == ["a title", "z title", "É title", "ä title", "Ω title"]


@pytest.mark.asyncio
async def test_build_demo_runtime_supports_partial_ported_builtins() -> None:
    runtime = await build_demo_runtime()

    output = await runtime.run("fetch order:123 | json get customer.email")

    assert "buyer@acme.example" in output
    assert "[exit:0 | " in output


@pytest.mark.asyncio
async def test_world_builder_oracle_runner_and_assertions_work_together() -> None:
    scenario = ScenarioSpec(
        id="fetch-json-email",
        category="structured",
        description="Fetch a JSON resource and extract an email field.",
        prompt="Look up order 123 and return the customer email.",
        max_turns=1,
        max_tool_calls=1,
        world=WorldSpec(
            fetch_resources={
                "order:123": {
                    "customer": {
                        "email": "buyer@acme.example",
                    }
                }
            }
        ),
        oracle=["fetch order:123 | json get customer.email"],
        assertions=AssertionSpec(
            final_answer=TextAssertionSpec(exact="buyer@acme.example"),
            trace=TraceAssertionSpec(
                max_calls=1,
                must_include=["json get customer.email"],
                steps=[TraceStepAssertionSpec(index=0, exit_code=0)],
            ),
        ),
    )

    runtime = await build_world(scenario.world)
    trace = await run_oracle(runtime, scenario)
    result = await assert_scenario(scenario, trace, runtime)

    assert trace.final_body == "buyer@acme.example"
    assert result.passed is True
    assert result.failures == []


@pytest.mark.asyncio
async def test_memory_scenario_assertions_cover_runtime_state() -> None:
    scenario = ScenarioSpec(
        id="memory-store-search",
        category="memory",
        description="Store a memory entry and retrieve it.",
        prompt="Store the owner in memory and retrieve it.",
        max_turns=2,
        max_tool_calls=2,
        world=WorldSpec(memory=["Acme prefers Monday follow-ups."]),
        oracle=[
            'memory store "Owner: sara@example.com"',
            "memory search sara@example.com",
        ],
        assertions=AssertionSpec(
            final_answer=TextAssertionSpec(contains=["sara@example.com"]),
            memory=MemoryAssertionSpec(contains=["Owner: sara@example.com"]),
            trace=TraceAssertionSpec(
                max_calls=2,
                must_include=["memory store", "memory search"],
                steps=[
                    TraceStepAssertionSpec(index=0, exit_code=0),
                    TraceStepAssertionSpec(index=1, exit_code=0, contains=["sara@example.com"]),
                ],
            ),
        ),
    )

    runtime = await build_world(scenario.world)
    trace = await run_oracle(runtime, scenario)
    result = await assert_scenario(scenario, trace, runtime)

    assert result.passed is True
    assert result.failures == []


@pytest.mark.asyncio
async def test_command_harness_provides_stable_registry_and_execution_helpers() -> None:
    registry = create_test_command_registry()
    ctx = create_test_command_context()
    spec = get_registered_command("echo", registry)
    run_result = await run_registered_command("echo", ["hello", "world"])

    assert spec.name == "echo"
    assert ctx.registry.has("help") is True
    assert run_result.spec.name == "echo"
    assert stdout_text(run_result.result) == "hello world\n"
    assert stdin_text("hello") == b"hello"
    assert NO_STDIN == b""


@pytest.mark.asyncio
async def test_command_conformance_cases_run_against_public_harness() -> None:
    registry = create_test_command_registry()

    def make_ctx(_overrides=None):
        return create_test_command_context()

    cases = create_command_conformance_cases(
        CommandConformanceOptions(
            registry=registry,
            make_ctx=make_ctx,
        )
    )

    assert cases

    for case in cases:
        result = case.run()
        if hasattr(result, "__await__"):
            await result


def test_command_registry_uses_c_locale_order_for_non_ascii_names() -> None:
    registry = CommandRegistry()

    for name in ["z", "ä", "a", "É", "Ω"]:
        registry.register(
            CommandSpec(
                name=name,
                summary=f"{name} summary",
                usage=name,
                details=f"Examples:\n  {name}",
                handler=lambda _ctx, _args, _stdin, *, value=name: ok(value),
            )
        )

    assert registry.names() == ["a", "z", "É", "ä", "Ω"]
    assert [spec.name for spec in registry.all()] == ["a", "z", "É", "ä", "Ω"]
