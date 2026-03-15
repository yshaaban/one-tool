from __future__ import annotations

import pytest

from onetool.testing import RunRegisteredCommandOptions, run_registered_command, stdin_text, stdout_text


@pytest.mark.asyncio
async def test_sed_decodes_multiline_text_arguments_and_replacements() -> None:
    cases = [
        (["2a\\line A\\n\\tline B"], "alpha\nbeta\n", "alpha\nbeta\nline A\n\tline B\n"),
        (["2,3c\\line 1\\nline 2"], "a\nb\nc\nd\n", "a\nline 1\nline 2\nd\n"),
        (["2i\\line 0\\n\\tline 0.5"], "alpha\nbeta\n", "alpha\nline 0\n\tline 0.5\nbeta\n"),
        (["s/foo/bar\\n\\tbaz/"], "foo\n", "bar\n\tbaz\n"),
        (["s/foo/[&]/"], "foo\n", "[foo]\n"),
        ([r"s/\(foo\)/[\1]/"], "foo\n", "[foo]\n"),
        (["-E", r"s/x=([0-9]+),y=([0-9]+)/\2,\1/"], "x=10,y=20\n", "20,10\n"),
    ]

    for args, stdin_value, expected_stdout in cases:
        result = await run_registered_command(
            "sed",
            args,
            RunRegisteredCommandOptions(stdin=stdin_text(stdin_value)),
        )
        assert result.result.exit_code == 0
        assert stdout_text(result.result) == expected_stdout
