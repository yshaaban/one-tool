from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .errors import to_vfs_error, vfs_error
from .path_utils import parent_of


@dataclass(frozen=True, slots=True)
class VfsResourcePolicy:
    max_file_bytes: int | None = None
    max_total_bytes: int | None = None
    max_directory_depth: int | None = None
    max_entries_per_directory: int | None = None
    max_output_artifact_bytes: int | None = None


ResolvedVfsResourcePolicy = VfsResourcePolicy


@dataclass(slots=True)
class VfsSnapshot:
    files: dict[str, int]
    dirs: set[str]


EMPTY_RESOURCE_POLICY = VfsResourcePolicy()


def resolve_vfs_resource_policy(policy: VfsResourcePolicy | None = None) -> ResolvedVfsResourcePolicy:
    if policy is None:
        return EMPTY_RESOURCE_POLICY

    _validate_limit("maxFileBytes", policy.max_file_bytes)
    _validate_limit("maxTotalBytes", policy.max_total_bytes)
    _validate_limit("maxDirectoryDepth", policy.max_directory_depth)
    _validate_limit("maxEntriesPerDirectory", policy.max_entries_per_directory)
    _validate_limit("maxOutputArtifactBytes", policy.max_output_artifact_bytes)

    return VfsResourcePolicy(
        max_file_bytes=policy.max_file_bytes,
        max_total_bytes=policy.max_total_bytes,
        max_directory_depth=policy.max_directory_depth,
        max_entries_per_directory=policy.max_entries_per_directory,
        max_output_artifact_bytes=policy.max_output_artifact_bytes,
    )


def has_resource_policy(policy: ResolvedVfsResourcePolicy) -> bool:
    return any(
        value is not None
        for value in (
            policy.max_file_bytes,
            policy.max_total_bytes,
            policy.max_directory_depth,
            policy.max_entries_per_directory,
            policy.max_output_artifact_bytes,
        )
    )


def clone_snapshot(snapshot: VfsSnapshot) -> VfsSnapshot:
    return VfsSnapshot(files=dict(snapshot.files), dirs=set(snapshot.dirs))


def create_empty_snapshot() -> VfsSnapshot:
    return VfsSnapshot(files={}, dirs={"/"})


def create_snapshot_from_entries(files: Iterable[tuple[str, int]], dirs: Iterable[str]) -> VfsSnapshot:
    return VfsSnapshot(files=dict(files), dirs=set(dirs))


def apply_mkdir_to_snapshot(snapshot: VfsSnapshot, path: str, parents: bool) -> None:
    if path == "/":
        return
    if parents:
        _ensure_snapshot_parents(snapshot, path)
        return
    snapshot.dirs.add(path)


def apply_write_to_snapshot(snapshot: VfsSnapshot, path: str, size: int, make_parents: bool) -> None:
    if make_parents:
        _ensure_snapshot_parents(snapshot, parent_of(path))
    snapshot.files[path] = size


def apply_append_to_snapshot(snapshot: VfsSnapshot, path: str, size_delta: int, make_parents: bool) -> None:
    if make_parents:
        _ensure_snapshot_parents(snapshot, parent_of(path))
    snapshot.files[path] = snapshot.files.get(path, 0) + size_delta


def apply_delete_to_snapshot(snapshot: VfsSnapshot, path: str) -> None:
    if path in snapshot.files:
        del snapshot.files[path]
        return

    prefix = f"{path}/"
    for file_path in list(snapshot.files):
        if file_path.startswith(prefix):
            del snapshot.files[file_path]

    for dir_path in list(snapshot.dirs):
        if dir_path == path or dir_path.startswith(prefix):
            snapshot.dirs.remove(dir_path)

    snapshot.dirs.add("/")


def apply_copy_to_snapshot(snapshot: VfsSnapshot, src: str, dst: str) -> None:
    if src in snapshot.files:
        _ensure_snapshot_parents(snapshot, parent_of(dst))
        snapshot.files[dst] = snapshot.files[src]
        return

    prefix = "/" if src == "/" else f"{src}/"
    _ensure_snapshot_parents(snapshot, parent_of(dst))
    snapshot.dirs.add(dst)

    for dir_path in list(snapshot.dirs):
        if dir_path != src and dir_path.startswith(prefix):
            snapshot.dirs.add(dst + dir_path[len(src) :])

    for file_path, size in list(snapshot.files.items()):
        if file_path.startswith(prefix):
            snapshot.files[dst + file_path[len(src) :]] = size


def apply_move_to_snapshot(snapshot: VfsSnapshot, src: str, dst: str) -> None:
    if src == dst:
        return
    apply_copy_to_snapshot(snapshot, src, dst)
    apply_delete_to_snapshot(snapshot, src)


def enforce_resource_policy(
    snapshot: VfsSnapshot,
    policy: ResolvedVfsResourcePolicy,
    context_path: str,
) -> None:
    if not has_resource_policy(policy):
        return

    total_bytes = 0
    children_by_dir: dict[str, int] = {}

    for dir_path in snapshot.dirs:
        if dir_path != "/":
            depth = _path_depth(dir_path)
            if policy.max_directory_depth is not None and depth > policy.max_directory_depth:
                raise _limit_error(context_path, "maxDirectoryDepth", policy.max_directory_depth, depth)
            _increment_child_count(children_by_dir, parent_of(dir_path))

    for file_path, size in snapshot.files.items():
        total_bytes += size

        if policy.max_file_bytes is not None and size > policy.max_file_bytes:
            raise _limit_error(file_path, "maxFileBytes", policy.max_file_bytes, size)

        if (
            policy.max_output_artifact_bytes is not None
            and _is_runtime_artifact_path(file_path)
            and size > policy.max_output_artifact_bytes
        ):
            raise _limit_error(
                file_path,
                "maxOutputArtifactBytes",
                policy.max_output_artifact_bytes,
                size,
            )

        _increment_child_count(children_by_dir, parent_of(file_path))

    if policy.max_total_bytes is not None and total_bytes > policy.max_total_bytes:
        raise _limit_error(context_path, "maxTotalBytes", policy.max_total_bytes, total_bytes)

    if policy.max_entries_per_directory is not None:
        for dir_path, count in children_by_dir.items():
            if count > policy.max_entries_per_directory:
                raise _limit_error(
                    dir_path,
                    "maxEntriesPerDirectory",
                    policy.max_entries_per_directory,
                    count,
                )


def check_resource_limit_error(value: object) -> bool:
    caught = to_vfs_error(value)
    return caught is not None and caught.code == "ERESOURCE_LIMIT"


def _ensure_snapshot_parents(snapshot: VfsSnapshot, path: str) -> None:
    if path == "/":
        snapshot.dirs.add("/")
        return

    current = ""
    for segment in filter(None, path.split("/")):
        current += f"/{segment}"
        snapshot.dirs.add(current)


def _increment_child_count(children_by_dir: dict[str, int], dir_path: str) -> None:
    children_by_dir[dir_path] = children_by_dir.get(dir_path, 0) + 1


def _path_depth(path: str) -> int:
    return len([segment for segment in path.split("/") if segment])


def _is_runtime_artifact_path(path: str) -> bool:
    return path.startswith("/.system/cmd-output/")


def _limit_error(path: str, limit_kind: str, limit: int, actual: int) -> VfsError:
    return vfs_error(
        "ERESOURCE_LIMIT",
        path,
        details={
            "limitKind": limit_kind,
            "limit": limit,
            "actual": actual,
        },
    )


def _validate_limit(name: str, value: int | None) -> None:
    if value is None:
        return
    if not isinstance(value, int) or value < 0:
        raise ValueError(f"{name} must be a non-negative integer")
