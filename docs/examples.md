# Example Catalog

Runnable examples for `one-tool`, organized by intent rather than by internal file history.

Use:

```bash
npm run examples:list
npm run example -- <slug>
```

High-value aliases remain available for:

- `npm run demo`
- `npm run agent`
- `npm run example:custom-command`
- `npm run example:run-detailed`
- `npm run example:browser-vfs`
- `npm run example:incident-investigator`

---

## Tier 1 — Quickstarts

Start here when you are evaluating the SDK or wiring the first integration.

| Slug                         | What it shows                                                | Run command                                     |
| ---------------------------- | ------------------------------------------------------------ | ----------------------------------------------- |
| `quickstart-node-basic`      | basic runtime creation, `NodeVFS`, and `buildToolDefinition` | `npm run example -- quickstart-node-basic`      |
| `quickstart-readonly-preset` | safe built-in preset selection                               | `npm run example -- quickstart-readonly-preset` |
| `quickstart-run-detailed`    | structured execution, traces, and presentation metadata      | `npm run example:run-detailed`                  |
| `quickstart-custom-command`  | a minimal custom command using `one-tool/extensions`         | `npm run example:custom-command`                |

---

## Tier 2 — Feature Recipes

Use these when you already understand the core runtime and want an exact pattern for one capability.

| Slug                             | What it shows                                                    | Run command                                         |
| -------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| `recipe-command-selection`       | presets, group selection, exclusions, and custom-only runtimes   | `npm run example -- recipe-command-selection`       |
| `recipe-command-overrides`       | caller-owned registries, replacement, and unregistering commands | `npm run example -- recipe-command-overrides`       |
| `recipe-extension-helpers`       | `one-tool/extensions` helpers for inputs, flags, and VFS errors  | `npm run example -- recipe-extension-helpers`       |
| `recipe-testing-custom-commands` | `one-tool/testing` harnesses and conformance helpers             | `npm run example -- recipe-testing-custom-commands` |
| `recipe-browser-vfs`             | `BrowserVFS` persistence and reopen flow                         | `npm run example:browser-vfs`                       |
| `recipe-prompt-variants`         | full, minimal, and terse tool descriptions                       | `npm run example -- recipe-prompt-variants`         |
| `recipe-overflow-and-binary`     | truncation metadata and binary-guard behavior                    | `npm run example -- recipe-overflow-and-binary`     |
| `recipe-scenario-testing`        | `buildWorld`, `runOracle`, and `assertScenario`                  | `npm run example -- recipe-scenario-testing`        |

---

## Tier 3 — Applied Samples

These are deterministic domain-shaped examples. They are meant to answer “what would I actually build with this?”

| Slug                        | What it shows                                                   | Run command                               |
| --------------------------- | --------------------------------------------------------------- | ----------------------------------------- |
| `app-incident-investigator` | logs + config + fetch/search + report writing                   | `npm run example:incident-investigator`   |
| `app-support-desk`          | a custom support command with built-ins, reports, and memory    | `npm run example -- app-support-desk`     |
| `app-knowledge-brief`       | search + fetch + write + memory for reusable briefing workflows | `npm run example -- app-knowledge-brief`  |
| `app-browser-notebook`      | persistent note-taking with `BrowserVFS`                        | `npm run example -- app-browser-notebook` |

---

## Tier 4 — Reference Examples

These are maintained end-to-end paths that show the repo’s opinionated reference integrations.

| Slug                           | What it shows                                            | Run command                                       |
| ------------------------------ | -------------------------------------------------------- | ------------------------------------------------- |
| `reference-demo-cli`           | seeded interactive CLI runtime                           | `npm run demo`                                    |
| `reference-provider-agent`     | provider-backed agent loop over an OpenAI-compatible API | `npm run agent`                                   |
| `reference-http-tool-endpoint` | a simple HTTP wrapper around the runtime                 | `npm run example -- reference-http-tool-endpoint` |

---

## How to choose

- Start with a **quickstart** if you are new to the library.
- Use a **recipe** when you need a specific API pattern.
- Use an **application** when you need a richer multi-command workflow.
- Use a **reference** example when you want a maintained end-to-end integration path.

---

## Coverage map

The catalog covers the current public surfaces:

- `runDetailed(...)` → `quickstart-run-detailed`, `recipe-overflow-and-binary`
- command presets and selective registration → `quickstart-readonly-preset`, `recipe-command-selection`
- registry overrides → `recipe-command-overrides`
- `one-tool/extensions` → `quickstart-custom-command`, `recipe-extension-helpers`
- `one-tool/testing` → `recipe-testing-custom-commands`, `recipe-scenario-testing`
- `BrowserVFS` → `recipe-browser-vfs`, `app-browser-notebook`
- prompt variants → `recipe-prompt-variants`
- provider-backed agent loop → `reference-provider-agent`
