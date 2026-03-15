from __future__ import annotations

from dataclasses import dataclass

from ..memory import SimpleMemory
from ..runtime import create_agent_cli
from ..types import ToolAdapters
from ..vfs.interface import VFS
from ..vfs.memory_vfs import MemoryVFS
from .adapters import DemoFetch, DemoSearch
from .demo_fixtures import DEMO_FETCH_RESOURCES, DEMO_SEARCH_DOCS, seed_demo_memory, seed_demo_vfs


@dataclass(frozen=True, slots=True)
class DemoRuntimeOptions:
    vfs: VFS | None = None


seed_vfs = seed_demo_vfs
seed_memory = seed_demo_memory


async def build_demo_runtime(
    options: DemoRuntimeOptions | None = None,
    **runtime_options: object,
):
    resolved = options or DemoRuntimeOptions()
    create_options = dict(runtime_options)
    vfs = create_options.get("vfs") or resolved.vfs or MemoryVFS()
    await seed_vfs(vfs)

    memory = create_options.get("memory") or SimpleMemory()
    seed_memory(memory)

    create_options.setdefault("vfs", vfs)
    create_options.setdefault(
        "adapters",
        ToolAdapters(
            search=DemoSearch(DEMO_SEARCH_DOCS),
            fetch=DemoFetch(DEMO_FETCH_RESOURCES),
        ),
    )
    create_options.setdefault("memory", memory)

    return await create_agent_cli(**create_options)
