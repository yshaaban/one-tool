from __future__ import annotations

from collections.abc import Callable
import errno
import os
from pathlib import Path
import shutil
import stat

from ..c_locale import to_c_locale_sort_bytes
from .errors import vfs_error
from .interface import VFS, VFileInfo, guess_media_type
from .path_utils import base_name, is_strict_descendant_path, parent_of, posix_normalize
from .policy import (
    VfsResourcePolicy,
    VfsSnapshot,
    apply_append_to_snapshot,
    apply_copy_to_snapshot,
    apply_mkdir_to_snapshot,
    apply_move_to_snapshot,
    apply_write_to_snapshot,
    clone_snapshot,
    create_empty_snapshot,
    enforce_resource_policy,
    has_resource_policy,
    resolve_vfs_resource_policy,
)


class LocalVFS(VFS):
    def __init__(self, root_dir: str | os.PathLike[str], *, resource_policy: VfsResourcePolicy | None = None) -> None:
        root_path = Path(root_dir)
        root_path.mkdir(parents=True, exist_ok=True)
        self.root_dir = str(root_path.resolve())
        self.resource_policy = resolve_vfs_resource_policy(resource_policy)

    def normalize(self, input_path: str) -> str:
        return posix_normalize(input_path)

    def resolve(self, input_path: str) -> str:
        normalized = self.normalize(input_path)
        relative = normalized.removeprefix("/")
        target = os.path.abspath(os.path.join(self.root_dir, relative))
        try:
            common_path = os.path.commonpath([self.root_dir, target])
        except ValueError as caught:
            raise vfs_error("EESCAPE", normalized, cause=caught) from caught

        if common_path != self.root_dir:
            raise vfs_error("EESCAPE", normalized)
        return target

    async def exists(self, input_path: str) -> bool:
        return self._stat_path(self.normalize(input_path)) is not None

    async def is_dir(self, input_path: str) -> bool:
        stats = self._stat_path(self.normalize(input_path))
        return stats is not None and stat.S_ISDIR(stats.st_mode)

    async def mkdir(self, input_path: str, parents: bool = True) -> str:
        normalized = self.normalize(input_path)
        if normalized == "/":
            return normalized

        existing = self._stat_path(normalized)
        if existing is not None and not stat.S_ISDIR(existing.st_mode):
            raise vfs_error("EEXIST", normalized)
        if existing is not None and stat.S_ISDIR(existing.st_mode):
            if parents:
                return normalized
            raise vfs_error("EEXIST", normalized)

        if parents:
            self._validate_parents(normalized)
        else:
            self._ensure_directory_exists(parent_of(normalized))

        self._enforce_policy(normalized, lambda snapshot: apply_mkdir_to_snapshot(snapshot, normalized, parents))

        if parents:
            os.makedirs(self.resolve(normalized), exist_ok=True)
        else:
            os.mkdir(self.resolve(normalized))
        return normalized

    async def listdir(self, input_path: str = "/") -> list[str]:
        normalized = self.normalize(input_path)
        stats = self._stat_path(normalized)
        if stats is None:
            raise vfs_error("ENOENT", normalized)
        if not stat.S_ISDIR(stats.st_mode):
            raise vfs_error("ENOTDIR", normalized)

        entries: list[tuple[str, bool]] = []
        with os.scandir(self.resolve(normalized)) as iterator:
            for entry in iterator:
                if entry.is_symlink():
                    continue
                is_dir = entry.is_dir(follow_symlinks=False)
                entries.append((entry.name, is_dir))

        entries.sort(key=_listdir_sort_key)
        return [name + ("/" if is_dir else "") for name, is_dir in entries]

    async def read_bytes(self, input_path: str) -> bytes:
        normalized = self.normalize(input_path)
        stats = self._stat_path(normalized)
        if stats is None:
            raise vfs_error("ENOENT", normalized)
        if stat.S_ISDIR(stats.st_mode):
            raise vfs_error("EISDIR", normalized)

        with open(self.resolve(normalized), "rb") as handle:
            return handle.read()

    async def read_text(self, input_path: str) -> str:
        return (await self.read_bytes(input_path)).decode("utf-8", errors="replace")

    async def write_bytes(self, input_path: str, data: bytes, make_parents: bool = True) -> str:
        normalized = self.normalize(input_path)
        self._ensure_writable_path(normalized, make_parents)
        self._enforce_policy(
            normalized,
            lambda snapshot: apply_write_to_snapshot(snapshot, normalized, len(data), make_parents),
        )
        self._ensure_parent_path(normalized, make_parents)

        with open(self.resolve(normalized), "wb") as handle:
            handle.write(data)
        return normalized

    async def append_bytes(self, input_path: str, data: bytes, make_parents: bool = True) -> str:
        normalized = self.normalize(input_path)
        self._ensure_writable_path(normalized, make_parents)
        self._enforce_policy(
            normalized,
            lambda snapshot: apply_append_to_snapshot(snapshot, normalized, len(data), make_parents),
        )
        self._ensure_parent_path(normalized, make_parents)

        with open(self.resolve(normalized), "ab") as handle:
            handle.write(data)
        return normalized

    async def delete(self, input_path: str) -> str:
        normalized = self.normalize(input_path)
        if normalized == "/":
            raise vfs_error("EROOT", normalized)

        stats = self._stat_path(normalized)
        if stats is None:
            raise vfs_error("ENOENT", normalized)

        resolved = self.resolve(normalized)
        if stat.S_ISDIR(stats.st_mode):
            shutil.rmtree(resolved)
        else:
            os.unlink(resolved)
        return normalized

    async def copy(self, src: str, dst: str) -> tuple[str, str]:
        src_path = self.normalize(src)
        dst_path = self.normalize(dst)
        src_stats = self._stat_path(src_path)

        if src_stats is None:
            raise vfs_error("ENOENT", src_path)
        if stat.S_ISDIR(src_stats.st_mode) and is_strict_descendant_path(src_path, dst_path):
            raise vfs_error("EINVAL", dst_path, target_path=src_path)

        dst_stats = self._stat_path(dst_path)
        if stat.S_ISDIR(src_stats.st_mode):
            if dst_stats is not None:
                raise vfs_error("EEXIST", dst_path)
        elif dst_stats is not None and stat.S_ISDIR(dst_stats.st_mode):
            raise vfs_error("EISDIR", dst_path)

        self._ensure_parent_path(dst_path, True)
        self._enforce_policy(dst_path, lambda snapshot: apply_copy_to_snapshot(snapshot, src_path, dst_path))

        resolved_src = self.resolve(src_path)
        resolved_dst = self.resolve(dst_path)
        os.makedirs(os.path.dirname(resolved_dst), exist_ok=True)

        if stat.S_ISDIR(src_stats.st_mode):
            shutil.copytree(resolved_src, resolved_dst, symlinks=True)
        else:
            shutil.copyfile(resolved_src, resolved_dst)

        return (src_path, dst_path)

    async def move(self, src: str, dst: str) -> tuple[str, str]:
        src_path = self.normalize(src)
        dst_path = self.normalize(dst)
        if src_path == dst_path:
            return (src_path, dst_path)

        src_stats = self._stat_path(src_path)
        if src_stats is None:
            raise vfs_error("ENOENT", src_path)
        if stat.S_ISDIR(src_stats.st_mode) and is_strict_descendant_path(src_path, dst_path):
            raise vfs_error("EINVAL", dst_path, target_path=src_path)

        dst_stats = self._stat_path(dst_path)
        if stat.S_ISDIR(src_stats.st_mode):
            if dst_stats is not None:
                raise vfs_error("EEXIST", dst_path)
        elif dst_stats is not None and stat.S_ISDIR(dst_stats.st_mode):
            raise vfs_error("EISDIR", dst_path)

        self._ensure_parent_path(dst_path, True)
        self._enforce_policy(dst_path, lambda snapshot: apply_move_to_snapshot(snapshot, src_path, dst_path))

        resolved_src = self.resolve(src_path)
        resolved_dst = self.resolve(dst_path)
        os.makedirs(os.path.dirname(resolved_dst), exist_ok=True)

        try:
            os.replace(resolved_src, resolved_dst)
        except OSError as caught:
            if caught.errno != errno.EXDEV:
                raise
            if stat.S_ISDIR(src_stats.st_mode):
                shutil.copytree(resolved_src, resolved_dst, symlinks=True)
                shutil.rmtree(resolved_src)
            else:
                shutil.copyfile(resolved_src, resolved_dst)
                os.unlink(resolved_src)

        return (src_path, dst_path)

    async def stat(self, input_path: str) -> VFileInfo:
        normalized = self.normalize(input_path)
        stats = self._stat_path(normalized)
        if stats is None:
            return VFileInfo(
                path=normalized,
                exists=False,
                is_dir=False,
                size=0,
                media_type="",
                modified_epoch_ms=0,
            )

        is_dir = stat.S_ISDIR(stats.st_mode)
        return VFileInfo(
            path=normalized,
            exists=True,
            is_dir=is_dir,
            size=0 if is_dir else stats.st_size,
            media_type=guess_media_type(base_name(normalized), is_dir),
            modified_epoch_ms=int(stats.st_mtime * 1000),
        )

    def _stat_path(self, normalized_path: str) -> os.stat_result | None:
        self._assert_no_symlink_traversal(normalized_path)
        try:
            return os.stat(self.resolve(normalized_path))
        except FileNotFoundError:
            return None

    def _assert_no_symlink_traversal(self, normalized_path: str) -> None:
        if normalized_path == "/":
            return

        current_host_path = self.root_dir
        current_virtual_path = ""

        for segment in filter(None, normalized_path.split("/")):
            current_virtual_path += f"/{segment}"
            current_host_path = os.path.join(current_host_path, segment)
            try:
                stats = os.lstat(current_host_path)
            except FileNotFoundError:
                return

            if stat.S_ISLNK(stats.st_mode):
                raise vfs_error("EESCAPE", current_virtual_path)

    def _ensure_directory_exists(self, normalized_path: str) -> None:
        stats = self._stat_path(normalized_path)
        if stats is None:
            raise vfs_error("ENOENT", normalized_path)
        if not stat.S_ISDIR(stats.st_mode):
            raise vfs_error("ENOTDIR", normalized_path)

    def _validate_parents(self, normalized_path: str) -> None:
        if normalized_path == "/":
            return

        current = ""
        for segment in filter(None, normalized_path.split("/")):
            current += f"/{segment}"
            stats = self._stat_path(current)
            if stats is not None and not stat.S_ISDIR(stats.st_mode):
                raise vfs_error("ENOTDIR", current)

    def _ensure_parent_path(self, normalized_path: str, make_parents: bool) -> None:
        parent_path = parent_of(normalized_path)
        if make_parents:
            self._validate_parents(parent_path)
            os.makedirs(self.resolve(parent_path), exist_ok=True)
            return
        self._ensure_directory_exists(parent_path)

    def _ensure_writable_path(self, normalized_path: str, make_parents: bool) -> None:
        target_stats = self._stat_path(normalized_path)
        if target_stats is not None and stat.S_ISDIR(target_stats.st_mode):
            raise vfs_error("EISDIR", normalized_path)

        if make_parents:
            self._validate_parents(parent_of(normalized_path))
            return
        self._ensure_directory_exists(parent_of(normalized_path))

    def _create_snapshot(self) -> VfsSnapshot:
        snapshot = create_empty_snapshot()
        self._walk_snapshot("/", self.root_dir, snapshot)
        return snapshot

    def _walk_snapshot(self, normalized_dir: str, resolved_dir: str, snapshot: VfsSnapshot) -> None:
        with os.scandir(resolved_dir) as iterator:
            for entry in iterator:
                child_normalized = f"/{entry.name}" if normalized_dir == "/" else f"{normalized_dir}/{entry.name}"
                child_resolved = os.path.join(resolved_dir, entry.name)

                if entry.is_symlink():
                    continue
                if entry.is_dir(follow_symlinks=False):
                    snapshot.dirs.add(child_normalized)
                    self._walk_snapshot(child_normalized, child_resolved, snapshot)
                    continue
                if entry.is_file(follow_symlinks=False):
                    snapshot.files[child_normalized] = os.stat(child_resolved).st_size

    def _enforce_policy(self, context_path: str, mutate: Callable[[VfsSnapshot], None]) -> None:
        if not has_resource_policy(self.resource_policy):
            return
        snapshot = clone_snapshot(self._create_snapshot())
        mutate(snapshot)
        enforce_resource_policy(snapshot, self.resource_policy, context_path)


def _listdir_sort_key(entry: tuple[str, bool]) -> tuple[int, bytes]:
    name, is_dir = entry
    return (0 if is_dir else 1, to_c_locale_sort_bytes(name))
