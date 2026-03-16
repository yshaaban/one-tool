# Architecture Principles

This document captures the architectural rules that make `@onetool/one-tool` coherent.

Use it when you are:

- changing the runtime
- adding or expanding commands
- adjusting the browser or MCP surfaces
- updating examples, docs, or the site
- deciding whether a new feature fits the product model

The goal is not to maximize features. The goal is to preserve the shape of the product.

## Product definition

`one-tool` gives a model exactly one tool:

- `run(command)`

Behind that one entrypoint, the runtime provides:

- a rooted virtual workspace
- built-in commands for files, text, data, memory, and adapters
- optional adapters and memory
- browser and MCP integration surfaces

It is intentionally:

- more structured than a catalog of narrow tools
- narrower and easier to constrain than a shell or Python sandbox

## Core principles

### 1. One model-facing tool

The primary model contract is `run(command)`.

Do:

- keep new capabilities accessible through the existing command language when they fit
- preserve one coherent tool description and discovery story
- optimize for agent planning inside one tool call

Do not:

- fragment the model surface into many narrow tools without a very strong reason
- add parallel tool interfaces that bypass the command model for convenience

### 2. Rooted workspace, not a shell

The runtime operates on a workspace rooted under `/`.

Do:

- preserve rooted path semantics
- keep relative paths resolving under `/`
- keep command behavior independent of host cwd or process state

Do not:

- add cwd mutation
- add environment expansion
- add redirection, background execution, or process spawning semantics
- let commands escape the workspace model

### 3. Explicit registry and allowed operations

The runtime executes only registered commands.

Do:

- keep commands explicit and discoverable through `help`
- keep command metadata complete and accurate
- keep errors command-prefixed and usage-oriented

Do not:

- add hidden command behavior that bypasses registration
- make command availability depend on implicit global state

### 4. Safety and determinism over shell fidelity

`one-tool` can support familiar CLI forms, but it is not trying to become a full Unix shell.

Do:

- add familiar syntax when it improves model behavior
- preserve runtime output limits, binary guards, and VFS policy checks
- document intentional divergences instead of masking them

Do not:

- claim or imply full shell parity
- weaken safety boundaries to chase compatibility

### 5. Measurable compatibility, not “close enough”

GNU-style compatibility is a supported subset, not a vague aspiration.

Do:

- back meaningful compatibility claims with oracle tests where appropriate
- compare stdout, stderr, and exit codes explicitly
- keep locale-sensitive parity under controlled conditions such as `LC_ALL=C`

Do not:

- expand compatibility claims without tests
- treat anecdotal behavior matches as a sufficient contract

### 6. Provider-agnostic core runtime

The runtime is not an LLM-provider SDK.

Do:

- keep provider logic at the integration edge
- keep the core runtime focused on parsing, execution, and formatting
- keep browser and server integrations as thin adapters over the same runtime model

Do not:

- entangle provider-specific assumptions into core runtime behavior
- let one demo integration redefine the product architecture

### 7. One workspace model across backends

`NodeVFS`, `MemoryVFS`, and `BrowserVFS` should present the same conceptual workspace.

Do:

- keep backend differences operational, not conceptual
- preserve typed VFS errors and policy semantics
- make examples and docs portable across backends when possible

Do not:

- introduce backend-specific command semantics without a compelling reason
- let demos drift from the maintained runtime model

### 8. Discovery must stay cheap

Agents should learn the runtime from the runtime.

Do:

- keep `help` accurate
- write usage strings that guide recovery
- preserve stderr and exit codes as useful planning signals
- keep examples representative of how the runtime is actually used

Do not:

- rely on the model memorizing undocumented behavior
- hide key behavior only in prose docs

### 9. Docs, examples, and site must teach the same model

The product is only coherent if all communication layers agree.

Do:

- keep README, command reference, examples, and site copy aligned
- update help text, docs, and examples together when behavior changes
- prefer concrete, developer-facing language over marketing language

Do not:

- let examples teach stale forms after command behavior changes
- let site copy overclaim browser support, parity, or integration guarantees

## Layer responsibilities

### Public surfaces

Files:

- `src/index.ts`
- `src/browser.ts`
- package exports

Responsibilities:

- define what consumers can import
- expose focused subpaths without leaking internal structure
- keep browser-safe and Node-only surfaces explicit

### Runtime orchestration

Files:

- `src/runtime.ts`

Responsibilities:

- parse the command language
- execute pipelines and chains
- format model-facing output
- expose structured execution
- build tool descriptions

The runtime owns orchestration, not command-specific policy.

### Command layer

Files:

- `src/commands/groups/*.ts`

Responsibilities:

- define command contracts
- parse command-specific arguments
- implement command behavior
- produce accurate summaries, usage strings, and examples

Compatibility work usually belongs here.

### Shared command internals

Files:

- `src/commands/shared/*.ts`

Responsibilities:

- hold reusable parsers and engines when multiple commands or tests clearly benefit
- keep complex behavior contained without hiding command contracts

Do not move logic here unless reuse or complexity clearly justifies it.

### Workspace layer

Files:

- `src/vfs/*.ts`

Responsibilities:

- implement rooted storage
- enforce storage policies
- surface typed VFS errors
- keep backend semantics aligned

### Integration layer

Files:

- `src/mcp/*`
- `src/browser.ts`
- adapter and testing surfaces

Responsibilities:

- expose the runtime in specific environments
- preserve the same underlying runtime model
- keep integrations thin and honest about their constraints

### Verification layer

Files:

- `test/*`
- `test/oracles/*`
- `test/differential/*`
- `snapshots/*`
- `scripts/snapshot.ts`
- `scripts/snapshot/*`

Responsibilities:

- protect user-visible behavior
- make compatibility claims measurable
- keep scenario coverage readable and deterministic

### Parity layer

Files:

- `python/*`
- `snapshots/*`
- `scripts/snapshot.ts`
- `scripts/snapshot/*`
- `test/differential/*`

Responsibilities:

- keep TypeScript as the source of truth for behavior
- generate golden snapshots from TypeScript and verify them in Python
- detect cross-runtime drift through direct differential tests
- make portability claims explicit and measurable

### Communication layer

Files:

- `README.md`
- `docs/*.md`
- `examples/*`
- `site/src/*`

Responsibilities:

- explain the actual product model
- teach the supported command surface
- stay aligned with runtime behavior and integration constraints

## Decision rules

Use these when a change is ambiguous.

### Prefer one clear model over many local conveniences

If a feature makes one area easier but weakens the overall product shape, do not take it by default.

### Prefer explicitness over hidden magic

If behavior matters to the model or the developer, it should be visible in:

- command metadata
- help text
- docs
- tests

### Prefer deletion over layering

When multiple commits introduce competing helpers or patterns, converge on one.

### Prefer narrow, testable compatibility

When adding Unix-familiar behavior:

- support the subset that matters
- test it
- document the boundaries

Do not chase completeness without a product reason.

## Applying these principles to GNU-style compatibility

The recent compatibility work is a good example of the intended decision process.

What fit the principles:

- extending existing commands instead of adding new tools
- keeping compatibility scoped to the command layer
- preserving rooted VFS semantics
- adding oracle-backed parity tests
- documenting the supported subset and intentional differences
- updating examples and site copy to match the new supported forms

What would have violated the principles:

- pretending the runtime is a full shell
- adding recursive shell behavior outside command contracts
- broad compatibility claims without tests
- leaving help text, examples, or the site on older command forms

## Contributor checklist

Before merging feature work, check:

- Does this preserve the one-tool model?
- Does it preserve rooted workspace semantics?
- Is the behavior owned by the right layer?
- Are compatibility claims measured, not implied?
- Do help text, docs, examples, and site copy match the behavior?
- Is the final implementation simpler and more coherent than the accumulated branch history?

If the answer to any of these is no, the feature is not ready.
