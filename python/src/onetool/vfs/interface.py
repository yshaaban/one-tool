from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class VFileInfo:
    path: str
    exists: bool
    is_dir: bool
    size: int
    media_type: str
    modified_epoch_ms: int


class VFS(Protocol):
    def normalize(self, input_path: str) -> str:
        ...

    async def exists(self, input_path: str) -> bool:
        ...

    async def is_dir(self, input_path: str) -> bool:
        ...

    async def mkdir(self, input_path: str, parents: bool = True) -> str:
        ...

    async def listdir(self, input_path: str = "/") -> list[str]:
        ...

    async def read_bytes(self, input_path: str) -> bytes:
        ...

    async def read_text(self, input_path: str) -> str:
        ...

    async def write_bytes(self, input_path: str, data: bytes, make_parents: bool = True) -> str:
        ...

    async def append_bytes(self, input_path: str, data: bytes, make_parents: bool = True) -> str:
        ...

    async def delete(self, input_path: str) -> str:
        ...

    async def copy(self, src: str, dst: str) -> tuple[str, str]:
        ...

    async def move(self, src: str, dst: str) -> tuple[str, str]:
        ...

    async def stat(self, input_path: str) -> VFileInfo:
        ...


_MIME_BY_EXTENSION: dict[str, str] = {
    ".csv": "text/csv",
    ".gif": "image/gif",
    ".html": "text/html",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".json": "application/json",
    ".md": "text/markdown",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".webp": "image/webp",
    ".xml": "application/xml",
    ".yaml": "application/yaml",
    ".yml": "application/yaml",
}


def guess_media_type(file_name: str, is_dir: bool) -> str:
    if is_dir:
        return "inode/directory"
    dot = file_name.rfind(".")
    if dot == -1:
        return "application/octet-stream"
    extension = file_name[dot:].lower()
    return _MIME_BY_EXTENSION.get(extension, "application/octet-stream")
