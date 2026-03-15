from __future__ import annotations

from onetool.vfs.errors import (
    format_escape_path_error_message,
    format_resource_limit_error_message,
    to_vfs_error,
    vfs_error,
)
from onetool.vfs.policy import check_resource_limit_error


def test_to_vfs_error_prefers_structured_attributes_over_exception_message() -> None:
    class ExternalError(Exception):
        def __init__(self) -> None:
            super().__init__("ENOENT:/tmp/fallback")
            self.code = "EINVAL"
            self.path = "/real/path"
            self.target_path = "/target/path"
            self.details = {"limitKind": "maxFileBytes"}

    caught = to_vfs_error(ExternalError())

    assert caught is not None
    assert caught.code == "EINVAL"
    assert caught.path == "/real/path"
    assert caught.target_path == "/target/path"
    assert caught.details == {"limitKind": "maxFileBytes"}


def test_vfs_error_formatters_match_typescript_wording() -> None:
    resource_limit = vfs_error(
        "ERESOURCE_LIMIT",
        "/reports/out.txt",
        details={"limitKind": "maxFileBytes", "limit": 3, "actual": 5},
    )
    assert (
        format_resource_limit_error_message("write", resource_limit)
        == "write: resource limit exceeded (maxFileBytes: 5 > 3) at /reports/out.txt"
    )

    escape_error = vfs_error("EESCAPE", "../../outside.txt")
    assert (
        format_escape_path_error_message("cat", escape_error, "/fallback")
        == "cat: path escapes workspace root: ../../outside.txt"
    )


def test_check_resource_limit_error_accepts_structured_wrapped_errors() -> None:
    class WrappedError(Exception):
        def __init__(self) -> None:
            super().__init__("boom")
            self.code = "ERESOURCE_LIMIT"
            self.path = "/reports/out.txt"

    assert check_resource_limit_error(WrappedError()) is True
