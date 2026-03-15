from __future__ import annotations

from collections.abc import Awaitable, Callable
from pathlib import Path

import pytest

from onetool import LocalVFS
from onetool.vfs.errors import VfsError
from onetool.vfs.policy import VfsResourcePolicy


def _make_vfs(tmp_path: Path, policy: VfsResourcePolicy | None = None) -> LocalVFS:
    return LocalVFS(tmp_path / "workspace", resource_policy=policy)


@pytest.mark.asyncio
async def test_resolve_clamps_paths_inside_root(tmp_path: Path) -> None:
    vfs = _make_vfs(tmp_path)

    resolved = vfs.resolve("/../../etc/passwd")

    assert resolved == str(Path(vfs.root_dir) / "etc" / "passwd")


@pytest.mark.asyncio
async def test_delete_root_raises_eroot(tmp_path: Path) -> None:
    vfs = _make_vfs(tmp_path)

    with pytest.raises(VfsError, match="EROOT:/"):
        await vfs.delete("/")


@pytest.mark.asyncio
async def test_stat_reports_directory_size_as_zero(tmp_path: Path) -> None:
    vfs = _make_vfs(tmp_path)

    await vfs.mkdir("/dir", True)
    info = await vfs.stat("/dir")

    assert info.is_dir is True
    assert info.size == 0
    assert info.modified_epoch_ms > 0


@pytest.mark.asyncio
async def test_copy_directory_into_its_child_raises_einval(tmp_path: Path) -> None:
    vfs = _make_vfs(tmp_path)

    await vfs.write_bytes("/src/main.ts", b"code")

    with pytest.raises(VfsError, match="EINVAL:/src/sub"):
        await vfs.copy("/src", "/src/sub")


@pytest.mark.asyncio
async def test_move_directory_into_its_child_raises_einval(tmp_path: Path) -> None:
    vfs = _make_vfs(tmp_path)

    await vfs.write_bytes("/src/main.ts", b"code")

    with pytest.raises(VfsError, match="EINVAL:/src/sub"):
        await vfs.move("/src", "/src/sub")


@pytest.mark.asyncio
async def test_copy_overwrites_existing_files(tmp_path: Path) -> None:
    vfs = _make_vfs(tmp_path)

    await vfs.write_bytes("/src.txt", b"source")
    await vfs.write_bytes("/dst.txt", b"stale")
    await vfs.copy("/src.txt", "/dst.txt")

    assert await vfs.read_bytes("/dst.txt") == b"source"


@pytest.mark.asyncio
async def test_move_overwrites_existing_files(tmp_path: Path) -> None:
    vfs = _make_vfs(tmp_path)

    await vfs.write_bytes("/src.txt", b"source")
    await vfs.write_bytes("/dst.txt", b"stale")
    await vfs.move("/src.txt", "/dst.txt")

    assert await vfs.read_bytes("/dst.txt") == b"source"
    assert await vfs.exists("/src.txt") is False


@pytest.mark.asyncio
async def test_read_rejects_symlinked_files(tmp_path: Path) -> None:
    outside_root = tmp_path / "outside"
    outside_root.mkdir()
    (outside_root / "secret.txt").write_text("secret", encoding="utf-8")

    vfs = _make_vfs(tmp_path)
    (Path(vfs.root_dir) / "secret-link.txt").symlink_to(outside_root / "secret.txt")

    with pytest.raises(VfsError, match="EESCAPE:/secret-link.txt"):
        await vfs.read_bytes("/secret-link.txt")

    assert await vfs.listdir("/") == []


@pytest.mark.asyncio
async def test_listdir_hides_symlink_entries(tmp_path: Path) -> None:
    outside_root = tmp_path / "outside"
    outside_root.mkdir()
    (outside_root / "secret.txt").write_text("secret", encoding="utf-8")

    vfs = _make_vfs(tmp_path)
    (Path(vfs.root_dir) / "secret-link.txt").symlink_to(outside_root / "secret.txt")
    await vfs.write_bytes("/notes.txt", b"hello")
    await vfs.mkdir("/docs", True)

    assert await vfs.listdir("/") == ["docs/", "notes.txt"]


@pytest.mark.asyncio
async def test_write_rejects_symlinked_parent_directories(tmp_path: Path) -> None:
    outside_root = tmp_path / "outside"
    linked_dir = outside_root / "linked-dir"
    linked_dir.mkdir(parents=True)

    vfs = _make_vfs(tmp_path)
    (Path(vfs.root_dir) / "linked").symlink_to(linked_dir, target_is_directory=True)

    with pytest.raises(VfsError, match="EESCAPE:/linked"):
        await vfs.write_bytes("/linked/report.txt", b"hello")


@pytest.mark.parametrize(
    ("policy", "operation", "expected_path", "limit_kind", "limit", "actual"),
    [
        (
            VfsResourcePolicy(max_file_bytes=3),
            lambda vfs: vfs.write_bytes("/notes/report.txt", b"hello"),
            "/notes/report.txt",
            "maxFileBytes",
            3,
            5,
        ),
        (
            VfsResourcePolicy(max_total_bytes=5),
            lambda vfs: _write_sequence(vfs, [("/a.txt", b"abc"), ("/b.txt", b"def")]),
            "/b.txt",
            "maxTotalBytes",
            5,
            6,
        ),
        (
            VfsResourcePolicy(max_directory_depth=2),
            lambda vfs: vfs.write_bytes("/a/b/c/file.txt", b"x"),
            "/a/b/c/file.txt",
            "maxDirectoryDepth",
            2,
            3,
        ),
        (
            VfsResourcePolicy(max_entries_per_directory=1),
            lambda vfs: _write_sequence(vfs, [("/first.txt", b"a"), ("/second.txt", b"b")]),
            "/",
            "maxEntriesPerDirectory",
            1,
            2,
        ),
        (
            VfsResourcePolicy(max_output_artifact_bytes=2),
            lambda vfs: vfs.write_bytes("/.system/cmd-output/cmd-0001.txt", b"abc"),
            "/.system/cmd-output/cmd-0001.txt",
            "maxOutputArtifactBytes",
            2,
            3,
        ),
    ],
)
@pytest.mark.asyncio
async def test_resource_policy_limits_match_other_vfs_backends(
    tmp_path: Path,
    policy: VfsResourcePolicy,
    operation: Callable[[LocalVFS], Awaitable[object]],
    expected_path: str,
    limit_kind: str,
    limit: int,
    actual: int,
) -> None:
    vfs = _make_vfs(tmp_path, policy)

    with pytest.raises(VfsError) as caught:
        await operation(vfs)

    assert caught.value.code == "ERESOURCE_LIMIT"
    assert caught.value.path == expected_path
    assert caught.value.details == {
        "limitKind": limit_kind,
        "limit": limit,
        "actual": actual,
    }


async def _write_sequence(vfs: LocalVFS, writes: list[tuple[str, bytes]]) -> None:
    for file_path, payload in writes:
        await vfs.write_bytes(file_path, payload)
