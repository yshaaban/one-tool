from __future__ import annotations

import onetool
from onetool import commands, extensions, testing, vfs


def test_top_level_exports_cover_current_foundation_surface() -> None:
    assert onetool.AgentCLI is not None
    assert onetool.build_tool_definition is not None
    assert onetool.create_agent_cli is not None
    assert onetool.create_command_registry is not None
    assert onetool.create_command_conformance_cases is not None
    assert onetool.create_test_command_context is not None
    assert onetool.run_registered_command is not None
    assert onetool.DemoSearch is not None
    assert onetool.DemoFetch is not None
    assert onetool.build_world is not None
    assert onetool.run_oracle is not None
    assert onetool.assert_scenario is not None
    assert onetool.LocalVFS is not None
    assert onetool.VfsErrorCode is not None
    assert onetool.ResolvedVfsResourcePolicy is not None
    assert onetool.to_vfs_error is not None
    assert onetool.is_vfs_error is not None

    assert commands.create_command_registry is not None
    assert extensions.read_json_input is not None
    assert testing.create_command_conformance_cases is not None
    assert testing.create_test_command_context is not None
    assert testing.run_registered_command is not None
    assert vfs.LocalVFS is not None
