from __future__ import annotations

import time
from collections.abc import Callable

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
    create_snapshot_from_entries,
    enforce_resource_policy,
    has_resource_policy,
    resolve_vfs_resource_policy,
)


class MemoryVFS(VFS):
    def __init__(
        self,
        *,
        resource_policy: VfsResourcePolicy | None = None,
        _now_ms: Callable[[], int] | None = None,
    ) -> None:
        self._now_ms = _now_ms or _default_now_ms
        self._files: dict[str, tuple[bytes, int]] = {}
        self._dirs: dict[str, int] = {"/": self._now_ms()}
        self.resource_policy = resolve_vfs_resource_policy(resource_policy)

    def normalize(self, input_path: str) -> str:
        return posix_normalize(input_path)

    async def exists(self, input_path: str) -> bool:
        path = self.normalize(input_path)
        return path in self._dirs or path in self._files

    async def is_dir(self, input_path: str) -> bool:
        return self.normalize(input_path) in self._dirs

    async def mkdir(self, input_path: str, parents: bool = True) -> str:
        path = self.normalize(input_path)
        if path in self._files:
            raise vfs_error("EEXIST", path)
        if parents:
            self._validate_parents(path)
        else:
            self._ensure_direct_parent(path)
        self._enforce_policy(path, lambda snapshot: apply_mkdir_to_snapshot(snapshot, path, parents))
        if parents:
            self._ensure_parents(path)
            return path
        if path not in self._dirs:
            self._dirs[path] = self._now_ms()
        return path

    async def listdir(self, input_path: str = "/") -> list[str]:
        path = self.normalize(input_path)
        if path not in self._dirs:
            if path in self._files:
                raise vfs_error("ENOTDIR", path)
            raise vfs_error("ENOENT", path)

        prefix = "/" if path == "/" else f"{path}/"
        entries: list[tuple[str, bool]] = []

        for dir_path in self._dirs:
            if dir_path == path or not dir_path.startswith(prefix):
                continue
            rest = dir_path[len(prefix) :]
            if "/" not in rest:
                entries.append((rest, True))

        for file_path in self._files:
            if not file_path.startswith(prefix):
                continue
            rest = file_path[len(prefix) :]
            if "/" not in rest:
                entries.append((rest, False))

        entries.sort(key=_listdir_sort_key)
        return [name + ("/" if is_dir else "") for name, is_dir in entries]

    async def read_bytes(self, input_path: str) -> bytes:
        path = self.normalize(input_path)
        if path in self._dirs:
            raise vfs_error("EISDIR", path)
        entry = self._files.get(path)
        if entry is None:
            raise vfs_error("ENOENT", path)
        return bytes(entry[0])

    async def read_text(self, input_path: str) -> str:
        return (await self.read_bytes(input_path)).decode("utf-8", errors="replace")

    async def write_bytes(self, input_path: str, data: bytes, make_parents: bool = True) -> str:
        path = self.normalize(input_path)
        if path in self._dirs:
            raise vfs_error("EISDIR", path)
        if make_parents:
            self._validate_parents(parent_of(path))
        else:
            self._ensure_direct_parent(path)
        self._enforce_policy(path, lambda snapshot: apply_write_to_snapshot(snapshot, path, len(data), make_parents))
        if make_parents:
            self._ensure_parents(parent_of(path))
        else:
            self._ensure_direct_parent(path)
        self._files[path] = (bytes(data), self._now_ms())
        return path

    async def append_bytes(self, input_path: str, data: bytes, make_parents: bool = True) -> str:
        path = self.normalize(input_path)
        if path in self._dirs:
            raise vfs_error("EISDIR", path)
        if make_parents:
            self._validate_parents(parent_of(path))
        else:
            self._ensure_direct_parent(path)
        self._enforce_policy(path, lambda snapshot: apply_append_to_snapshot(snapshot, path, len(data), make_parents))
        if make_parents:
            self._ensure_parents(parent_of(path))
        else:
            self._ensure_direct_parent(path)
        existing = self._files.get(path)
        if existing is None:
            merged = bytes(data)
        else:
            merged = existing[0] + bytes(data)
        self._files[path] = (merged, self._now_ms())
        return path

    async def delete(self, input_path: str) -> str:
        path = self.normalize(input_path)
        if path in self._files:
            del self._files[path]
            return path
        if path in self._dirs:
            if path == "/":
                raise vfs_error("EROOT", path)
            prefix = f"{path}/"
            for file_path in list(self._files):
                if file_path.startswith(prefix):
                    del self._files[file_path]
            for dir_path in list(self._dirs):
                if dir_path == path or dir_path.startswith(prefix):
                    del self._dirs[dir_path]
            return path
        raise vfs_error("ENOENT", path)

    async def copy(self, src: str, dst: str) -> tuple[str, str]:
        src_path = self.normalize(src)
        dst_path = self.normalize(dst)

        if src_path in self._files:
            data, _mtime = self._files[src_path]
            self._validate_parents(parent_of(dst_path))
            self._enforce_policy(dst_path, lambda snapshot: apply_copy_to_snapshot(snapshot, src_path, dst_path))
            await self.write_bytes(dst_path, data)
            return (src_path, dst_path)

        if src_path in self._dirs:
            if is_strict_descendant_path(src_path, dst_path):
                raise vfs_error("EINVAL", dst_path, target_path=src_path)
            if dst_path in self._dirs or dst_path in self._files:
                raise vfs_error("EEXIST", dst_path)
            self._validate_parents(parent_of(dst_path))
            self._enforce_policy(dst_path, lambda snapshot: apply_copy_to_snapshot(snapshot, src_path, dst_path))

            prefix = "/" if src_path == "/" else f"{src_path}/"
            source_dirs = [dir_path for dir_path in self._dirs if dir_path == src_path or dir_path.startswith(prefix)]
            source_files = [
                (file_path, entry)
                for file_path, entry in self._files.items()
                if file_path.startswith(prefix)
            ]

            self._ensure_parents(parent_of(dst_path))
            self._dirs[dst_path] = self._now_ms()

            for dir_path in source_dirs:
                if dir_path == src_path:
                    continue
                self._dirs[dst_path + dir_path[len(src_path) :]] = self._now_ms()

            for file_path, entry in source_files:
                self._files[dst_path + file_path[len(src_path) :]] = (bytes(entry[0]), self._now_ms())

            return (src_path, dst_path)

        raise vfs_error("ENOENT", src_path)

    async def move(self, src: str, dst: str) -> tuple[str, str]:
        src_path = self.normalize(src)
        dst_path = self.normalize(dst)
        dst_parent = parent_of(dst_path)

        if src_path == dst_path:
            return (src_path, dst_path)

        if src_path in self._files:
            if dst_path in self._dirs:
                raise vfs_error("EISDIR", dst_path)
            self._validate_parents(dst_parent)
            self._enforce_policy(dst_path, lambda snapshot: apply_move_to_snapshot(snapshot, src_path, dst_path))
            entry = self._files[src_path]
            self._ensure_parents(dst_parent)
            self._files[dst_path] = (bytes(entry[0]), self._now_ms())
            del self._files[src_path]
            return (src_path, dst_path)

        if src_path in self._dirs:
            if is_strict_descendant_path(src_path, dst_path):
                raise vfs_error("EINVAL", dst_path, target_path=src_path)
            if dst_path in self._dirs or dst_path in self._files:
                raise vfs_error("EEXIST", dst_path)
            self._validate_parents(dst_parent)
            self._enforce_policy(dst_path, lambda snapshot: apply_move_to_snapshot(snapshot, src_path, dst_path))

            prefix = "/" if src_path == "/" else f"{src_path}/"
            source_dirs = [dir_path for dir_path in self._dirs if dir_path == src_path or dir_path.startswith(prefix)]
            source_files = [
                (file_path, entry)
                for file_path, entry in self._files.items()
                if file_path.startswith(prefix)
            ]

            self._ensure_parents(dst_parent)
            self._dirs[dst_path] = self._now_ms()

            for dir_path in source_dirs:
                if dir_path != src_path:
                    self._dirs[dst_path + dir_path[len(src_path) :]] = self._now_ms()

            for file_path, entry in source_files:
                self._files[dst_path + file_path[len(src_path) :]] = (bytes(entry[0]), self._now_ms())

            await self.delete(src_path)
            return (src_path, dst_path)

        raise vfs_error("ENOENT", src_path)

    async def stat(self, input_path: str) -> VFileInfo:
        path = self.normalize(input_path)
        if path in self._dirs:
            return VFileInfo(
                path=path,
                exists=True,
                is_dir=True,
                size=0,
                media_type="inode/directory",
                modified_epoch_ms=self._dirs.get(path, 0),
            )

        entry = self._files.get(path)
        if entry is not None:
            return VFileInfo(
                path=path,
                exists=True,
                is_dir=False,
                size=len(entry[0]),
                media_type=guess_media_type(base_name(path), False),
                modified_epoch_ms=entry[1],
            )

        return VFileInfo(
            path=path,
            exists=False,
            is_dir=False,
            size=0,
            media_type="",
            modified_epoch_ms=0,
        )

    def _ensure_direct_parent(self, normalized_path: str) -> None:
        parent = parent_of(normalized_path)
        if parent in self._files:
            raise vfs_error("ENOTDIR", parent)
        if parent not in self._dirs:
            raise vfs_error("ENOENT", parent)

    def _ensure_parents(self, normalized_path: str) -> None:
        current = ""
        for segment in filter(None, normalized_path.split("/")):
            current += f"/{segment}"
            if current in self._files:
                raise vfs_error("ENOTDIR", current)
            if current not in self._dirs:
                self._dirs[current] = self._now_ms()

    def _validate_parents(self, normalized_path: str) -> None:
        current = ""
        for segment in filter(None, normalized_path.split("/")):
            current += f"/{segment}"
            if current in self._files:
                raise vfs_error("ENOTDIR", current)

    def _create_snapshot(self) -> VfsSnapshot:
        return create_snapshot_from_entries(
            ((path, len(entry[0])) for path, entry in self._files.items()),
            self._dirs.keys(),
        )

    def _enforce_policy(self, context_path: str, mutate: Callable[[VfsSnapshot], None]) -> None:
        if not has_resource_policy(self.resource_policy):
            return
        snapshot = clone_snapshot(self._create_snapshot())
        mutate(snapshot)
        enforce_resource_policy(snapshot, self.resource_policy, context_path)


def _default_now_ms() -> int:
    return int(time.time() * 1000)


def _listdir_sort_key(entry: tuple[str, bool]) -> tuple[int, bytes]:
    name, is_dir = entry
    return (0 if is_dir else 1, to_c_locale_sort_bytes(name))
