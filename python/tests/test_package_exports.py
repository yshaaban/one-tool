from __future__ import annotations

import onetool


def test_top_level_exports_cover_current_foundation_surface() -> None:
    assert onetool.VfsErrorCode is not None
    assert onetool.ResolvedVfsResourcePolicy is not None
    assert onetool.to_vfs_error is not None
    assert onetool.is_vfs_error is not None
