# `sed`, `tr`, and `diff` parity target

This repo treats parity as an explicit compatibility target, not a vague aspiration.

## Target

For these commands, the intended compatibility target is:

- GNU behavior on Linux
- `LC_ALL=C`
- one-tool VFS paths instead of host filesystem paths

That means:

- differential tests compare one-tool output to the host GNU utility output
- tests force `LC_ALL=C` so character-array and regex behavior stays stable
- file operands refer to temporary host fixtures in tests and VFS paths in the SDK

## Why this target

- `tr` is byte-oriented in practice and behaves most predictably in the C locale
- `diff` output formatting is only trustworthy if compared against a concrete implementation
- `sed` is a language runtime, not just search/replace, so parity must be tested against a real oracle

## Constraints that remain intentional

- commands operate on the rooted VFS, not the host working directory
- path traversal rules and VFS policy limits still apply
- host-side `-f`/script files in tests are only for oracle comparison, not a change to the one-tool file model

## Oracle harness

The test helpers under `test/oracles/` provide:

- temporary fixture workspace creation
- `LC_ALL=C` execution of host `sed`, `tr`, and `diff`
- byte-accurate stdout capture
- exact exit-code capture

Primary helper:

- `test/oracles/parity-harness.ts` for generic fixture workspaces and host-process execution

Minimal usage:

```ts
import { textDecoder, textEncoder } from '../../src/types.js';
import { hasOracleUtility, runTrOracle, withOracleFixtureWorkspace } from '../oracles/parity-harness.js';

if (!(await hasOracleUtility('tr'))) {
  return;
}

await withOracleFixtureWorkspace(
  {
    'input.txt': 'banana\n',
  },
  async function (workspace): Promise<void> {
    const result = await runTrOracle(['a-z', 'A-Z'], {
      cwd: workspace.rootDir,
      stdin: textEncoder.encode('banana'),
    });

    console.log(textDecoder.decode(result.stdout));
  },
);
```

Guidelines:

- keep oracle fixtures rooted under the temporary workspace
- force locale through the harness instead of per-test ad hoc environment setup
- compare stdout bytes, stderr text, and exit codes separately
- skip parity tests when the host utility is unavailable instead of weakening expectations

These helpers exist to keep parity claims measurable and regression-friendly.
