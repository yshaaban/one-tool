# onetool (Python)

Supported Python package for [`one-tool`](../README.md).

The TypeScript runtime remains the source of truth. The Python package tracks behavior through TypeScript-generated snapshots plus direct differential tests.

## Install

From a local checkout:

```bash
python -m pip install ./python
```

Directly from GitHub without PyPI:

```bash
python -m pip install "git+https://github.com/yshaaban/one-tool.git#subdirectory=python"
```

For development inside this repo:

```bash
cd python
python -m pip install -e ".[dev]"
pytest -q
```

## Quick start

```python
import asyncio

from onetool import MemoryVFS, SimpleMemory, create_agent_cli


async def main() -> None:
    runtime = await create_agent_cli(
        vfs=MemoryVFS(),
        memory=SimpleMemory(),
    )
    print(await runtime.run("echo hello world"))


asyncio.run(main())
```

## What is included

- `AgentCLI` and `create_agent_cli(...)`
- built-in commands and command registry helpers
- `MemoryVFS` and `LocalVFS`
- tool schema generation
- testing helpers, oracle helpers, and conformance helpers

For the broader product model, command surface, and architecture docs, start with the main [`README.md`](../README.md).
