# E2E Test Strategy for the Single-Tool CLI Runtime

This document defines a **comprehensive end-to-end validation strategy** for the TypeScript CLI runtime, assuming we have access to a **fast LLM backend** and want to validate the full agent pattern, not just individual commands.

The goal is to test five things at once:

1. **Functional correctness** — does the task complete correctly?
2. **Agent behavior correctness** — does the model discover, compose, and recover the way this design intends?
3. **State correctness** — are file mutations, memory mutations, and fetch/search usage correct?
4. **Safety correctness** — does the runtime reject unsupported shell semantics and prevent unsafe path behaviors?
5. **Efficiency** — how many tool calls, retries, tokens, and milliseconds did success require?

---

## 1. What we are validating

This runtime is not just "a tool executor." It makes a stronger claim:

> A single `run(command)` interface with CLI-style composition can outperform a catalog of typed tools for many agent workflows.

So the test suite should validate both:

- **the runtime itself**
- **the interaction pattern between the runtime and the model**

That means the test plan must explicitly cover:

- command discovery (`help`, command-with-no-args usage)
- chain composition (`|`, `&&`, `||`, `;`)
- file manipulation through the rooted VFS
- structured retrieval (`fetch | json get ...`)
- memory workflows
- large-output navigation (overflow mode)
- binary-guard recovery (`cat` -> error -> `stat`)
- invalid command recovery
- unsupported shell syntax rejection
- path and mutation safety

---

## 2. Testing model: use a layered test pyramid

Do not rely on a single "LLM end-to-end" suite. Use four layers.

### Layer A — Deterministic contract tests

These are regular unit/integration tests with **no model in the loop**.

Purpose:

- prove parser correctness
- prove VFS correctness
- prove each command contract
- prove presentation-layer behavior
- localize failures before the LLM suite runs

Examples:

- parser respects `|`, `&&`, `||`, `;`
- `cat` rejects directories and binary files
- `grep -c` counts correctly
- overflow mode writes the full output to `/.system/cmd-output/...`
- `json get customer.email` resolves nested keys
- `rm` rejects dangerous inputs if you add such rules later

This suite should run on every PR.

### Layer B — Oracle scenario tests (no LLM)

Each E2E scenario should first be executable by a **deterministic command script**.

Purpose:

- prove the scenario is valid and solvable
- prove the fixture state is correct
- separate runtime regressions from model regressions

Example:

For a scenario like "find the customer email for order 123 and save it to a note," define an oracle plan:

```text
fetch order:123 | json get customer.email | write /notes/customer-email.txt
cat /notes/customer-email.txt
```

If the oracle fails, the scenario itself is bad and should not be blamed on the model.

### Layer C — LLM-in-the-loop E2E

This is the real evaluation of the pattern.

Purpose:

- validate discovery, recovery, and composition behavior
- validate final answers and final state
- collect trajectory metrics (tool calls, retries, errors, latency)

This suite should run on PR for a small smoke subset and nightly for the full matrix.

### Layer D — Cross-model + adversarial + soak

Purpose:

- validate robustness across model backends
- catch brittle prompt coupling
- test long-horizon behavior
- test safety and refusal boundaries

This should run nightly or pre-release.

---

## 3. Core design rule for the E2E harness

**Prefer deterministic assertions over LLM judging whenever possible.**

Use a judge model only when the final answer is genuinely semantic or free-form.

For most scenarios, prefer checking:

- final file contents
- final memory contents
- exact values extracted from JSON
- command trace invariants
- tool-call counts
- presence/absence of forbidden commands

A judge model is useful for:

- report quality
- summary adequacy
- semantic equivalence when exact wording is not expected

But the judge should never replace exact state assertions when exact state is available.

---

## 4. Harness architecture

Build the E2E runner around six components.

### 4.1 World builder

Creates a fresh runtime instance for each run.

Responsibilities:

- new temp root directory
- seed files
- seed search docs
- seed fetch resources
- seed memory
- configure overflow thresholds if made configurable
- inject fault scenarios if needed

Every test run must start from a clean world.

### 4.2 Agent runner

Runs the model in a tool loop until:

- it returns a final answer
- it exceeds max turns
- it exceeds max tool calls
- it hits a fatal harness error

### 4.3 Trace collector

Store every event:

- prompt variant used
- model identifier
- turn number
- tool call command
- tool output
- exit code from footer
- elapsed time
- token counts if available
- final answer
- final VFS snapshot
- final memory snapshot

Persist as JSONL so runs are easy to diff.

### 4.4 Assertion engine

Checks:

- final answer assertions
- file-state assertions
- memory-state assertions
- trace-shape assertions
- performance bounds
- safety constraints

### 4.5 Reporter

Outputs:

- pass/fail per scenario
- aggregate metrics per model
- per-scenario diffs from previous runs
- regression deltas
- saved failing transcripts

### 4.6 Baseline runner

A second runner should exist for **A/B comparison** against a multi-tool baseline.

This is how we validate the core claim of the design. Run the same tasks with:

- **CLI runtime:** one `run(command)` tool
- **baseline runtime:** `read_file`, `write_file`, `search`, `fetch`, `json_get`, `memory_store`, etc.

Then compare:

- task success
- tool calls
- invalid actions
- latency
- response tokens returned by tools
- recovery depth after errors

---

## 5. Scenario DSL

Use a scenario definition that is strict enough for exact validation but flexible enough for LLM trajectories.

```ts
export interface ScenarioSpec {
  id: string;
  category:
    | 'discovery'
    | 'composition'
    | 'files'
    | 'structured'
    | 'memory'
    | 'overflow'
    | 'binary'
    | 'safety'
    | 'long_horizon';
  description: string;
  prompt: string;
  promptVariant?: 'full-tool-description' | 'minimal-tool-description' | 'terse';
  maxTurns: number;
  maxToolCalls: number;
  repeats?: number;
  world: WorldSpec;
  oracle?: string[];
  assertions: AssertionSpec;
}

export interface WorldSpec {
  files?: Record<string, string | Uint8Array>;
  searchDocs?: Array<{ title: string; body: string; source: string }>;
  fetchResources?: Record<string, unknown>;
  memory?: string[];
}

export interface AssertionSpec {
  finalAnswer?: {
    exact?: string;
    regex?: string[];
    contains?: string[];
    notContains?: string[];
    semanticRubric?: string;
  };
  files?: Array<{
    path: string;
    exists?: boolean;
    contains?: string[];
    notContains?: string[];
    exact?: string;
  }>;
  trace?: {
    mustMatchInOrder?: string[];
    mustMatchAnyOrder?: string[];
    forbidden?: string[];
    maxInvalidCommands?: number;
    maxRecoverableErrors?: number;
    maxCalls?: number;
  };
  metrics?: {
    maxLatencyMs?: number;
    maxMeanToolCalls?: number;
  };
}
```

Important rule:

- do **not** assert exact command sequences unless the sequence really matters
- do assert **trace invariants**

Example:

Instead of asserting:

```text
1. cat /logs/app.log
2. grep timeout
3. tail -n 2
```

assert:

- one command must read `/logs/app.log`
- at least one command must use `grep`
- at least one command must use `tail -n 2`
- no forbidden unsupported shell syntax was used
- final answer must mention the two timeout lines

That keeps the suite robust to benign variation.

---

## 6. A simple TypeScript agent runner shape

The runner should be model-provider agnostic. Use any backend that supports a single tool call loop.

```ts
export interface LlmProvider {
  complete(input: {
    model: string;
    messages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }>;
    tools: Array<{
      name: 'run';
      description: string;
      inputSchema: {
        type: 'object';
        properties: { command: { type: 'string' } };
        required: ['command'];
      };
    }>;
    temperature?: number;
  }): Promise<
    | { type: 'tool_call'; name: 'run'; args: { command: string } }
    | { type: 'final'; text: string }
  >;
}
```

```ts
export async function runScenario(
  provider: LlmProvider,
  model: string,
  runtime: AgentCLI,
  scenario: ScenarioSpec,
): Promise<RunTrace> {
  const system = buildSystemPrompt(runtime, scenario.promptVariant);
  const messages = [
    { role: 'system' as const, content: system },
    { role: 'user' as const, content: scenario.prompt },
  ];

  const trace: RunTrace = {
    scenarioId: scenario.id,
    toolCalls: [],
    finalAnswer: '',
    turns: 0,
  };

  for (let turn = 0; turn < scenario.maxTurns; turn += 1) {
    trace.turns = turn + 1;

    const response = await provider.complete({
      model,
      messages,
      temperature: 0,
      tools: [
        {
          name: 'run',
          description: runtime.buildToolDescription(),
          inputSchema: {
            type: 'object',
            properties: { command: { type: 'string' } },
            required: ['command'],
          },
        },
      ],
    });

    if (response.type === 'final') {
      trace.finalAnswer = response.text;
      break;
    }

    const command = response.args.command;
    const output = await runtime.run(command);

    trace.toolCalls.push({ command, output });

    messages.push({ role: 'assistant', content: `[tool call] run(${JSON.stringify(command)})` });
    messages.push({ role: 'tool', content: output });

    if (trace.toolCalls.length >= scenario.maxToolCalls) {
      break;
    }
  }

  return trace;
}
```

This is enough to start.

---

## 7. What to measure on every E2E run

You want more than pass/fail.

### Hard pass/fail metrics

These should gate CI:

- scenario succeeded
- expected files were created/modified correctly
- forbidden commands were not used
- max tool-call limit not exceeded
- unsupported shell syntax was not accepted as valid execution

### Behavioral metrics

These validate the philosophy of the design:

- **first-pass success rate** — solved with no tool errors
- **eventual success rate** — solved after recovery
- **mean tool calls per success**
- **invalid command rate**
- **mean recoverable errors before success**
- **help usage rate** on minimal-injection scenarios
- **binary recovery steps** — steps from binary error to correct next action
- **overflow follow-up success** — after truncation, did the model use the overflow file intelligently?

### Cost and latency metrics

- median runtime latency per scenario
- p95 latency per scenario
- total prompt tokens / completion tokens if provider exposes them
- total tool output bytes returned to model
- total tool calls per run

### Cross-model robustness metrics

- pass rate by model
- pass rate variance by model
- trace divergence by model
- regression delta from prior build

---

## 8. Ten core E2E scenarios

These should become the initial benchmark set.

### 1. `help-discovery-tail`

**Goal:** validate progressive discovery for command arguments.

Prompt:

> Read only the last 3 lines of `/logs/app.log` and answer with those lines exactly.

Pass conditions:

- final answer contains the correct 3 lines
- accepted traces include either direct `tail -n 3` usage or `help tail` followed by a valid `tail` command
- no unsupported shell syntax

Why it matters:

- tests whether the model can use built-in CLI prior knowledge
- tests whether the help surface rescues it when it does not know the flag syntax

### 2. `log-error-count`

Prompt:

> How many `ERROR` lines are in `/logs/app.log`?

Pass conditions:

- final answer contains `3`
- trace includes a pipeline involving `/logs/app.log` and `grep -c ERROR`
- max tool calls <= 3

Why it matters:

- validates composition efficiency
- canonical "one CLI call replaces multiple typed calls" scenario

### 3. `timeout-tail`

Prompt:

> Show the last 2 timeout-related lines from the application log.

Pass conditions:

- final answer includes the correct 2 lines
- trace includes `grep timeout` and `tail -n 2`

Why it matters:

- validates multi-stage pipelines on text data

### 4. `fallback-config`

Prompt:

> If `/config/prod-missing.json` does not exist, use the default config and tell me the region.

Pass conditions:

- trace includes `||`
- final answer includes `us-east-1`
- max tool calls <= 2

Why it matters:

- validates conditional execution semantics

### 5. `fetch-json-field`

Prompt:

> Get the customer email for `order:123` and the order amount.

Pass conditions:

- final answer includes `buyer@acme.example`
- final answer includes `1499`
- trace includes `fetch order:123`
- trace includes `json get customer.email`

Why it matters:

- validates structured retrieval without requiring bespoke typed tools

### 6. `search-write-report`

Prompt:

> Search for the refund timeout incident, save a concise note to `/reports/refund.txt`, then answer with the saved text.

Pass conditions:

- `/reports/refund.txt` exists
- file contains incident content from search results
- final answer matches saved text
- trace includes `search ... | write /reports/refund.txt`

Why it matters:

- validates file creation via pipelines
- validates write-through workflows

### 7. `file-copy-and-append`

Prompt:

> Copy `/drafts/qbr.md` to `/reports/qbr-v1.md`, append the line `- Owner confirmed`, then answer with the full file.

Pass conditions:

- target file exists
- target file contains the original content plus the appended line
- trace includes `cp` and `append`

Why it matters:

- validates realistic file mutation workflows

### 8. `memory-distill-owner`

Prompt:

> Read `/accounts/acme.md`, store the owner information into memory, then answer who owns Acme.

Pass conditions:

- memory contains the owner fact or equivalent distilled text
- final answer includes `sara@example.com`
- trace includes file read and `memory store`

Why it matters:

- validates a non-file state mutation
- tests whether the agent can distill and reuse information

### 9. `binary-recovery-logo`

Prompt:

> Inspect `/images/logo.png` and tell me what kind of file it is and whether it can be read as text.

Pass conditions:

- initial `cat` is allowed but not required
- if `cat` is used and returns a binary error, the model should recover within 2 additional calls
- accepted recovery usually includes `stat /images/logo.png`
- final answer should identify it as a binary PNG-like file and say it is not readable as normal text

Why it matters:

- validates error-guided correction
- validates the binary guard behavior

### 10. `overflow-navigation-large-log`

Prompt:

> Find the repeated timeout user in the large log and tell me the count.

Fixture:

- seed a large log that will trigger truncation
- ensure the matching pattern does not appear in the first visible chunk

Pass conditions:

- first tool result is truncated
- trace later reads or greps the overflow file path from the truncation message
- final answer reports the correct user and count

Why it matters:

- validates the most important presentation-layer behavior for large outputs
- proves the model can navigate overflow files instead of being flooded with text

---

## 9. Adversarial and safety scenarios

These should always exist in addition to the ten core scenarios.

### Unsupported shell syntax

Prompt examples:

- "Write the search results to a file using `>`"
- "Use `*.log` to inspect all logs"
- "Run `$(cat /config/default.json)`"

Pass conditions:

- runtime rejects unsupported syntax cleanly
- model recovers using supported commands
- no hidden shell semantics are accidentally accepted

### Path traversal

Prompt example:

- "Write a note to `../../outside.txt`"

Pass conditions:

- path stays rooted inside the VFS
- final state confirms no escape

### Invalid command recovery

Prompt example:

- tell the model to use a plausible but nonexistent command such as `readfile`

Pass conditions:

- runtime returns prescriptive error
- model recovers with a valid command quickly

### Malformed JSON

Prompt example:

- ask the model to parse a file intentionally containing invalid JSON

Pass conditions:

- `json` returns a clear error
- model does not hallucinate fields from broken data

---

## 10. Prompt variants to test discovery pressure

Do not run all scenarios with the exact same system prompt.

Use at least three prompt variants.

### Variant A — Full tool description

Use `runtime.buildToolDescription()` exactly as intended.

Purpose:

- production-realistic baseline

### Variant B — Minimal tool description

System prompt only says:

- there is one tool `run(command)`
- it behaves like a CLI
- use `help` to discover commands

Purpose:

- tests the strength of progressive discovery

### Variant C — Terse description

Include command names only, not summaries.

Purpose:

- tests how much command-summary injection actually matters

This A/B/C prompt matrix is one of the best ways to validate the discovery design.

---

## 11. Cross-model strategy

Use at least three evaluation rings.

### PR smoke

- 4 to 6 core scenarios
- 1 fast model
- 1 repeat each
- temperature 0

Purpose:

- fast signal on obvious regressions

### Nightly full suite

- all core scenarios + adversarial suite
- 2 to 3 models
- 3 repeats each
- temperature 0 and optionally 0.2

Purpose:

- robustness and drift detection

### Pre-release benchmark

- all scenarios
- A/B against baseline multi-tool runtime
- 5 repeats each
- collect full metrics and trend lines

Purpose:

- validate the main claim of the architecture before shipping

If a provider is not fully deterministic, do not over-interpret single-run failures. Use repeated runs and confidence intervals.

---

## 12. Success thresholds

Start with thresholds like these.

### Hard gates for PR

- deterministic contract tests: **100% pass**
- oracle scenarios: **100% pass**
- E2E smoke: **100% hard-pass** on selected scenarios

### Nightly targets

- core-scenario eventual success: **>= 95%**
- adversarial eventual success: **>= 90%**
- median invalid command count: **<= 1**
- median recoverable errors before success: **<= 1**
- overflow follow-up success: **>= 95%**
- binary recovery within 2 calls: **>= 95%**

### Comparative targets vs baseline multi-tool runtime

You should expect the CLI runtime to win on at least one of these:

- lower mean tool calls
- higher eventual success
- lower invalid-action rate
- lower total tool-output tokens
- better recovery depth after failure

If it does not, the design may still be valid, but its claimed advantages are not yet demonstrated.

---

## 13. Useful implementation details

### Snapshot the world after every run

Capture:

- full VFS tree under `/`
- memory entries
- all overflow files under `/.system/cmd-output`

That makes regressions easy to inspect.

### Normalize outputs before judging

Strip:

- duration footer variability if exact timing is irrelevant
- provider-specific assistant wrappers
- trailing whitespace

Do **not** strip exit codes; they are part of the behavior under test.

### Record command classifications

For each tool call, label it automatically as one of:

- success
- recoverable error
- invalid command
- unsupported syntax
- binary guard
- overflow response

That makes behavioral metrics much easier to compute.

### Keep fixtures deterministic

Avoid live web access in E2E tests. Use deterministic adapters for:

- search
- fetch
- memory seed data

Only use live integrations in a separate, explicitly non-deterministic integration suite.

---

## 14. Recommended directory layout

```text
test/
  unit/
  integration/
  e2e/
    fixtures/
      worlds.ts
      large-log.ts
    providers/
      llm-provider.ts
      openai-compatible.ts
    scenarios/
      core.ts
      adversarial.ts
      benchmark.ts
    runner.ts
    assert.ts
    report.ts
    compare-baseline.ts
```

Suggested npm scripts:

```json
{
  "scripts": {
    "test:unit": "node --test dist/test/unit/**/*.test.js",
    "test:integration": "node --test dist/test/integration/**/*.test.js",
    "test:e2e:smoke": "node dist/test/e2e/runner.js --suite smoke",
    "test:e2e:nightly": "node dist/test/e2e/runner.js --suite nightly",
    "test:bench": "node dist/test/e2e/compare-baseline.js"
  }
}
```

---

## 15. The most important benchmark: compare behavior, not just correctness

The strongest validation of this architecture is not merely that tasks succeed.

It is that tasks succeed with better agent behavior:

- fewer tool calls
- fewer invalid actions
- faster recovery from errors
- less context flooding
- more stable navigation across discovery and overflow

That is what distinguishes this runtime from a normal "tool wrapper."

If you only measure final correctness, you will miss most of the value proposition.

---

## 16. Recommended next step

Implement the harness in this order:

1. scenario DSL
2. oracle runner
3. LLM runner
4. assertion engine
5. 10 core scenarios
6. baseline multi-tool comparison
7. nightly metrics dashboard

That sequence gets you useful signal quickly without making the E2E suite brittle.
