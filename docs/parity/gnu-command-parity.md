# GNU-style command parity target

This repo treats GNU/Linux compatibility as an explicit target for a supported subset of commands, not a vague aspiration.

For the per-command supported subset, see [`compatibility-matrix.md`](./compatibility-matrix.md).

## Covered commands

The current oracle-backed parity set is:

- `echo`
- `ls`
- `find`
- `grep`
- `head`
- `tail`
- `sort`
- `uniq`
- `wc`
- `sed`
- `tr`
- `diff`

These commands aim for:

- GNU behavior on Linux
- `LC_ALL=C`
- one-tool VFS paths instead of host filesystem paths

## What parity means here

Parity covers the subset we intentionally support:

- familiar flag syntax the model is likely to try
- close output and exit-code behavior for that subset
- explicit oracle comparisons against the host GNU utility

It does not mean one-tool pretends to be a full shell. The runtime still keeps its own constraints:

- commands operate on the rooted VFS, not the host working directory
- path traversal rules and VFS policy limits still apply
- there is no shell glob expansion, redirection, or process execution

## Command-specific notes

- `echo` follows common GNU/coreutils-style flag behavior for `-n`, `-e`, and `-E`, but shell-specific `echo` differences are still out of scope.
- `ls`, `find`, `grep`, `head`, `tail`, `sort`, `uniq`, and `wc` target the supported GNU subset used in the parity corpus.
- `sed`, `tr`, and `diff` remain the highest-fidelity parity commands because their behavior is harder to approximate safely without a real oracle.

## Oracle harness

The helpers under `test/oracles/` provide:

- temporary fixture workspace creation
- `LC_ALL=C` execution of host GNU utilities
- byte-accurate stdout capture
- exact exit-code capture

Primary helper:

- `test/oracles/parity-harness.ts`

It exposes:

- `runOracleProcess(...)` for generic host command execution
- command wrappers such as `runEchoOracle(...)`, `runGrepOracle(...)`, `runLsOracle(...)`, `runFindOracle(...)`, `runTrOracle(...)`, and `runDiffOracle(...)`
- `withOracleFixtureWorkspace(...)` for host fixture setup

Minimal usage:

```ts
import { textDecoder, textEncoder } from '../../src/types.js';
import { hasOracleUtility, runGrepOracle } from '../oracles/parity-harness.js';

if (!(await hasOracleUtility('grep'))) {
  return;
}

const result = await runGrepOracle(['-F', '-c', 'timeout'], {
  stdin: textEncoder.encode('timeout\nok\ntimeout\n'),
});

console.log(textDecoder.decode(result.stdout));
```

## Guidelines

- keep oracle fixtures rooted under the temporary workspace
- force locale through the harness instead of per-test ad hoc environment setup
- compare stdout bytes, stderr text, and exit codes separately
- skip parity tests when the host utility is unavailable instead of weakening expectations
- document intentional one-tool divergences instead of hiding them behind partial parity claims

These helpers keep compatibility claims measurable and regression-friendly.
