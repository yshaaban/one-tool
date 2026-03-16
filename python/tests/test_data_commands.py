from __future__ import annotations

import pytest

from onetool.testing import RunRegisteredCommandOptions, run_registered_command, stdin_text, stdout_text


@pytest.mark.asyncio
async def test_json_keys_use_c_locale_byte_order_for_unicode_keys() -> None:
    result = await run_registered_command(
        "json",
        ["keys"],
        RunRegisteredCommandOptions(
            stdin=stdin_text('{"z":1,"ä":2,"a":3,"É":4,"Ω":5}'),
        ),
    )

    assert result.result.exit_code == 0
    assert stdout_text(result.result) == "a\nz\nÉ\nä\nΩ"
