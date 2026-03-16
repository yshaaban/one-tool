# onetool (Python)

Supported Python package for [`one-tool`](../README.md).

`onetool` gives Python applications the same constrained `run(command)` runtime model as the TypeScript package:

- one rooted workspace
- built-in file, text, data, memory, and adapter commands
- structured execution through `run_detailed(...)`
- OpenAI-compatible tool schema generation
- testing and parity helpers for command- and scenario-level verification

The TypeScript runtime remains the source of truth. The Python package is maintained against TypeScript-generated snapshots plus direct differential tests.

## Status

The Python package is supported for use in Python projects today.

Current scope includes:

- `AgentCLI` and `create_agent_cli(...)`
- all built-in command groups and registry helpers
- `MemoryVFS` and `LocalVFS`
- tool schema generation
- extension helpers for custom commands
- testing helpers, oracle helpers, and command conformance helpers

Current non-goals for the Python package:

- browser-specific surfaces
- MCP server surfaces
- independent behavior from the TypeScript runtime

## Install

### From a local checkout

```bash
python -m pip install ./python
```

### Directly from GitHub

```bash
python -m pip install "git+https://github.com/yshaaban/one-tool.git#subdirectory=python"
```

Pin to a branch, tag, or commit when you want repeatable installs:

```bash
python -m pip install "git+https://github.com/yshaaban/one-tool.git@master#subdirectory=python"
```

### In another Python project before PyPI publishing

`requirements.txt`:

```text
git+https://github.com/yshaaban/one-tool.git#subdirectory=python
```

If your packaging workflow supports direct URL dependencies, you can also depend on the repo directly from `pyproject.toml`:

```toml
dependencies = [
  "onetool @ git+https://github.com/yshaaban/one-tool.git@master#subdirectory=python",
]
```

### For development inside this repo

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

## Common usage

### Run commands

```python
import asyncio

from onetool import MemoryVFS, create_agent_cli


async def main() -> None:
    runtime = await create_agent_cli(vfs=MemoryVFS())

    await runtime.ctx.vfs.write_bytes("/notes.txt", b"alpha\nbeta\ngamma\n", True)
    output = await runtime.run("grep beta /notes.txt")
    print(output)


asyncio.run(main())
```

### Get structured execution

```python
import asyncio

from onetool import MemoryVFS, create_agent_cli


async def main() -> None:
    runtime = await create_agent_cli(vfs=MemoryVFS())
    execution = await runtime.run_detailed("echo hello | wc -c")

    print(execution.exit_code)
    print(execution.presentation.stdout_mode)
    print(execution.trace[0].commands[0].argv)


asyncio.run(main())
```

### Build an OpenAI-compatible tool definition

```python
import asyncio

from onetool import MemoryVFS, build_tool_definition, create_agent_cli


async def main() -> None:
    runtime = await create_agent_cli(vfs=MemoryVFS())
    tool = build_tool_definition(runtime)
    print(tool["function"]["name"])


asyncio.run(main())
```

## Main public surface

Top-level imports are re-exported from [`python/src/onetool/__init__.py`](src/onetool/__init__.py).

Most integrations start with:

- `AgentCLI`
- `create_agent_cli`
- `build_tool_definition`
- `MemoryVFS`
- `LocalVFS`
- `SimpleMemory`

For custom command work, use:

- `create_command_registry`
- `CommandRegistry`
- `CommandSpec`
- helpers from `onetool.extensions`

For testing and parity-oriented usage, use:

- `create_test_command_context`
- `run_registered_command`
- `create_command_conformance_cases`
- `build_world`
- `run_oracle`
- `assert_scenario`
- demo adapters and fixtures from `onetool.testing`

## Command and VFS scope

The Python package includes the same built-in command groups as the maintained TypeScript runtime:

- `system`
- `fs`
- `text`
- `adapters`
- `data`

The maintained VFS backends in Python are:

- `MemoryVFS`
- `LocalVFS`

## Parity contract

The Python package follows the TypeScript runtime rather than defining a separate behavior contract.

When TypeScript behavior changes, the normal update loop is:

1. update TypeScript
2. regenerate snapshots
3. port the same behavior to Python
4. return the Python suite to green

This is why the Python package can be supported before it has its own fully separate docs or release pipeline: behavior is checked continuously against the TypeScript source of truth.

## Verification

From the repo root:

```bash
npm run snapshots
npm run snapshots:check
(cd python && pytest -q)
```

From the Python package directory only:

```bash
cd python
pytest -q
```

## Related docs

- main product overview: [`../README.md`](../README.md)
- API reference: [`../docs/api.md`](../docs/api.md)
- architecture principles: [`../docs/architecture-principles.md`](../docs/architecture-principles.md)
- command authoring guide: [`../COMMANDS.md`](../COMMANDS.md)
