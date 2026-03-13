# Changelog

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
