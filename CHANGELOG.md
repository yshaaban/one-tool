# Changelog

## [Unreleased]

## [0.2.0] - 2026-03-16

### Added

- Structured execution via `runDetailed(...)`, including per-command trace data and presentation metadata
- Public extension helpers at `one-tool/extensions` for command authors
- Deterministic scenario/oracle testing utilities at `one-tool/testing`
- Python package support as `onetool`, including the runtime, command layer, testing helpers, `MemoryVFS`, and `LocalVFS`
- Prompt-description variants for tool/schema generation and agent sessions
- Typed VFS errors, resource-policy enforcement, and execution-time materialization limits
- MCP server support with `createMcpServer(...)` and `serveStdioMcpServer(...)`
- Browser-safe package entrypoint at `one-tool/browser`
- Interactive website with a browser playground, guided examples, and an OpenRouter-backed agent demo
- Four new built-in commands: `tr`, `diff`, `sed`, and `echo`
- Snapshot corpus covering parser, VFS, utils, commands, runtime executions/tool descriptions, and oracle scenarios
- Differential TypeScript-vs-Python parity tests and shared snapshot-backed verification infrastructure

### Changed

- Simplified and reorganized examples into a smaller curated set with advanced examples separated from the main onboarding flow
- Refined browser and site UX, including terminal autocomplete, command highlighting, scripted example playback, and a clearer agent-focused flow
- Updated the site and README positioning around a constrained agent workspace instead of generic shell or code-interpreter framing
- Switched the browser LLM demo from direct OpenAI attempts to OpenRouter with a curated model picker
- Standardized C-locale sorting, comparison, and ASCII-only case folding across commands, VFS backends, adapters, and testing surfaces for deterministic cross-platform behavior
- Expanded the automated parity surface to 809 TypeScript tests and 302 Python tests

### Fixed

- Hardened NodeVFS rooted-workspace behavior by rejecting symlink traversal and surfacing workspace-escape errors consistently
- Improved VFS and command error formatting across typed errors, policy failures, and command-level recovery paths
- Tightened parity coverage and behavior for `tr`, `diff`, and `sed`, including clustered option parsing and in-place edit failure paths
- Improved browser example/runtime alignment so interactive examples use the correct runtime shape and autoplay/output behavior
- Fixed `sed` multiline editing escapes so `\n` and `\t` in `a`/`i`/`c` text and `s` replacements produce real newlines and tabs
- Fixed `sed` BRE literal metacharacter matching, negated addresses, zero-address ranges, and GNU-style range behavior across both runtimes

### Docs

- Split the oversized README into focused docs for API, commands, VFS, providers, and examples
- Expanded MCP, provider, browser, and extension-surface documentation
- Added richer browser-site copy and example guides that better reflect the SDK’s agent-oriented workflow
- Added Python package documentation and documented the TypeScript-to-Python snapshot parity workflow

## [0.1.0] - 2026-03-13

### Added

- Core runtime with `AgentCLI`, `createAgentCLI`, and a single `run(command)` tool surface
- 22 built-in commands: `ls`, `stat`, `cat`, `write`, `append`, `mkdir`, `cp`, `mv`, `rm`, `find`, `grep`, `head`, `tail`, `sort`, `uniq`, `wc`, `json`, `calc`, `search`, `fetch`, `help`, and `memory`
- Shell-like composition with pipes (`|`), `&&`, `||`, and `;`
- Three VFS backends: `NodeVFS`, `MemoryVFS`, and `BrowserVFS`
- Pluggable search and fetch adapters
- Lightweight working memory with store, search, and recent operations
- OpenAI-compatible tool schema generation
- Metadata-driven command conformance tests
- Public command selection and registry helpers
- Built-in command presets for common runtime shapes
- Reusable command conformance helper exported at `one-tool/testing`
- Stable public command-testing helpers exported at `one-tool/testing`
- `COMMANDS.md` developer guide for adding commands
- 300+ automated tests across runtime, commands, parser, VFS, provider support, memory, and utilities

### Tooling

- Comprehensive README with embedded SVG architecture diagrams
- Minimal ESLint and Prettier configuration for SDK maintenance
