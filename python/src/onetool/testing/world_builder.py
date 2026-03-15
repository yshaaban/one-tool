from __future__ import annotations

from ..memory import SimpleMemory
from ..runtime import create_agent_cli
from ..types import ToolAdapters
from ..utils import parent_path
from ..vfs.interface import VFS
from ..vfs.memory_vfs import MemoryVFS
from .adapters import DemoFetch, DemoSearch
from .scenario import WorldSpec

async def build_world(world: WorldSpec, **runtime_options: object):
    options = dict(runtime_options)
    vfs = _resolve_vfs(options.get("vfs"))
    memory = _resolve_memory(options.get("memory"))

    if world.files is not None:
        for file_path, content in sorted(world.files.items()):
            await vfs.mkdir(parent_path(file_path), True)
            data = content if isinstance(content, bytes) else content.encode("utf-8")
            await vfs.write_bytes(file_path, data, False)

    if world.memory is not None:
        for entry in world.memory:
            memory.store(entry)

    options.setdefault("vfs", vfs)
    options.setdefault("memory", memory)
    options.setdefault("adapters", _build_adapters(world))
    if world.output_limits is not None and "output_limits" not in options:
        options["output_limits"] = world.output_limits

    return await create_agent_cli(**options)


def _build_adapters(world: WorldSpec) -> ToolAdapters:
    adapters = ToolAdapters()

    if world.search_docs is not None:
        adapters.search = DemoSearch(world.search_docs)
    if world.fetch_resources is not None:
        adapters.fetch = DemoFetch(world.fetch_resources)

    return adapters


def _resolve_vfs(value: object) -> VFS:
    if value is None:
        return MemoryVFS()
    return value


def _resolve_memory(value: object) -> SimpleMemory:
    if value is None:
        return SimpleMemory()
    return value
