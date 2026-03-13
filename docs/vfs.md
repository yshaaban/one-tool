# VFS Guide

Guide to the virtual filesystem layer used by `one-tool`.

For the top-level overview, start with [`../README.md`](../README.md). For API reference, see [`api.md`](api.md).

---

## VFS interface

All backends implement the same `VFS` interface:

```ts
interface VFS {
  normalize(inputPath: string): string;
  exists(inputPath: string): Promise<boolean>;
  isDir(inputPath: string): Promise<boolean>;
  mkdir(inputPath: string, parents?: boolean): Promise<string>;
  listdir(inputPath?: string): Promise<string[]>;
  readBytes(inputPath: string): Promise<Uint8Array>;
  readText(inputPath: string): Promise<string>;
  writeBytes(inputPath: string, data: Uint8Array, makeParents?: boolean): Promise<string>;
  appendBytes(inputPath: string, data: Uint8Array, makeParents?: boolean): Promise<string>;
  delete(inputPath: string): Promise<string>;
  copy(src: string, dst: string): Promise<{ src: string; dst: string }>;
  move(src: string, dst: string): Promise<{ src: string; dst: string }>;
  stat(inputPath: string): Promise<VFileInfo>;
}
```

`stat(...)` returns:

```ts
interface VFileInfo {
  path: string;
  exists: boolean;
  isDir: boolean;
  size: number;
  mediaType: string;
  modifiedEpochMs: number;
}
```

---

## Backend comparison

| Backend      | Best for                       | Persistence                         | Notes                                |
| ------------ | ------------------------------ | ----------------------------------- | ------------------------------------ |
| `NodeVFS`    | server/runtime agents          | host filesystem under a chosen root | safest default for Node integrations |
| `MemoryVFS`  | tests, demos, ephemeral agents | none                                | fast and deterministic               |
| `BrowserVFS` | browser agents                 | IndexedDB                           | persistent client-side filesystem    |

---

## `NodeVFS`

```ts
import { NodeVFS } from 'one-tool';

const vfs = new NodeVFS('./agent_state');

const constrained = new NodeVFS('./agent_state', {
  resourcePolicy: {
    maxFileBytes: 256 * 1024,
    maxTotalBytes: 10 * 1024 * 1024,
    maxDirectoryDepth: 8,
    maxEntriesPerDirectory: 500,
    maxOutputArtifactBytes: 128 * 1024,
  },
});
```

Behavior:

- all virtual paths are rooted under `rootDir`
- path escape is blocked
- symlink entries inside the workspace are omitted from directory listings
- symlink traversal inside the workspace is rejected
- directories are created on demand for writes by default
- deleting `/` is rejected

`RootedVFS` is still exported as a deprecated alias for `NodeVFS`.

---

## `MemoryVFS`

```ts
import { MemoryVFS } from 'one-tool';

const vfs = new MemoryVFS();
```

Behavior:

- fully in-memory
- ideal for tests and embedding into higher-level harnesses
- mirrors the same path semantics as the other backends

---

## `BrowserVFS`

```ts
import { createAgentCLI } from 'one-tool';
import { BrowserVFS } from 'one-tool/vfs/browser';

const vfs = await BrowserVFS.open('my-agent-db');
const runtime = await createAgentCLI({ vfs });
```

Behavior:

- stored in IndexedDB
- survives reloads
- isolated by database name

Cleanup:

```ts
vfs.close();
await BrowserVFS.destroy('my-agent-db');
```

---

## Resource policies

All three backends support the same optional resource policy surface:

```ts
interface VfsResourcePolicy {
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxDirectoryDepth?: number;
  maxEntriesPerDirectory?: number;
  maxOutputArtifactBytes?: number;
}
```

Pass the policy through the backend constructor or `BrowserVFS.open(...)` options:

```ts
const vfs = new MemoryVFS({
  resourcePolicy: {
    maxFileBytes: 1024,
    maxTotalBytes: 4096,
  },
});
```

Meaning:

- `maxFileBytes` limits the size of any single file
- `maxTotalBytes` limits the total stored file bytes across the workspace
- `maxDirectoryDepth` limits how deep nested directories may become
- `maxEntriesPerDirectory` limits fanout under any directory
- `maxOutputArtifactBytes` limits runtime spill files under `/.system/cmd-output/`

Policies are enforced consistently across `NodeVFS`, `MemoryVFS`, and `BrowserVFS`.

These are storage policies. They constrain persisted workspace state and runtime spill artifacts.

If you also need to cap how much file or adapter data commands may materialize while executing, use the runtime-level execution policy:

```ts
const runtime = await createAgentCLI({
  vfs,
  executionPolicy: {
    maxMaterializedBytes: 64 * 1024,
  },
});
```

---

## Typed VFS errors

Backends now throw typed `VfsError` instances for SDK-defined filesystem failures:

```ts
import { VfsError, isVfsError, toVfsError } from 'one-tool';
```

The stable error codes are:

- `ENOENT`
- `EISDIR`
- `ENOTDIR`
- `EEXIST`
- `EINVAL`
- `EROOT`
- `EESCAPE`
- `ERESOURCE_LIMIT`

`ERESOURCE_LIMIT` includes structured `details` such as the limit kind, configured limit, and actual value.

This matters if you are writing custom commands or higher-level integrations: switch on `error.code` or use `toVfsError(...)` instead of parsing error strings.

---

## Virtual workspace example

The model sees a workspace that feels local:

<p align="center">
  <img src="diagrams/vfs-workspace.svg" alt="Diagram showing a rooted virtual workspace mapped onto NodeVFS, MemoryVFS, and BrowserVFS backends." width="980" />
</p>

That workspace might be backed by:

- a real directory on disk
- an in-memory map
- a browser IndexedDB database

The model does not need to care.
