from __future__ import annotations

import pytest

from onetool.testing import RunRegisteredCommandOptions, run_registered_command, stdin_text, stdout_text


@pytest.mark.asyncio
async def test_grep_uses_c_locale_semantics_for_non_ascii_patterns() -> None:
    input_text = "É\né\nE\ne\n"

    insensitive = await run_registered_command(
        "grep",
        ["-i", "é"],
        RunRegisteredCommandOptions(stdin=stdin_text(input_text)),
    )
    assert insensitive.result.exit_code == 0
    assert stdout_text(insensitive.result) == "é"

    single_byte_dot = await run_registered_command(
        "grep",
        ["^.$"],
        RunRegisteredCommandOptions(stdin=stdin_text(input_text)),
    )
    assert single_byte_dot.result.exit_code == 0
    assert stdout_text(single_byte_dot.result) == "E\ne"

    word_regex = await run_registered_command(
        "grep",
        [r"^\w$"],
        RunRegisteredCommandOptions(stdin=stdin_text(input_text)),
    )
    assert word_regex.result.exit_code == 0
    assert stdout_text(word_regex.result) == "E\ne"
