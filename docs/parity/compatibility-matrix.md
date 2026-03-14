# GNU-style compatibility matrix

Not every built-in command aims for GNU/Linux compatibility.

Use this page to answer two questions:

- which commands intentionally target a GNU-style subset
- which commands are defined by one-tool's own workspace model instead

For the overall target and oracle approach, see [`gnu-command-parity.md`](./gnu-command-parity.md).

## Compatibility intent

| Category                      | Commands                                                                                | Intent                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GNU-style subset              | `echo`, `ls`, `find`, `grep`, `head`, `tail`, `sort`, `uniq`, `wc`, `sed`, `tr`, `diff` | These commands accept a measured subset of familiar GNU/Linux forms. Compatibility claims are backed by oracle tests.                                         |
| Unix-inspired, product-shaped | `stat`, `cat`, `mkdir`, `cp`, `mv`, `rm`                                                | These commands use familiar CLI shapes, but their behavior is defined by one-tool's rooted workspace, safety rules, and VFS semantics rather than GNU parity. |
| Product-native                | `help`, `memory`, `write`, `append`, `json`, `calc`, `search`, `fetch`                  | These commands exist to support the one-tool runtime model. They do not aim for GNU/Linux compatibility.                                                      |

If a command is not in the GNU-style subset, treat its help text and the command reference as the source of truth.

## Oracle-backed GNU-style subset

| Command | Supported familiar forms                                                               | Oracle-backed | Notes                                                                                       |
| ------- | -------------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------- |
| `echo`  | `-n`, `-e`, `-E`                                                                       | yes           | Common coreutils-style behavior only; shell-specific `echo` differences remain out of scope |
| `ls`    | `-1`, `-a`, `-l`, `-R`                                                                 | yes           | Rooted VFS paths only; no color, owner, group, or permission-bit fidelity                   |
| `find`  | `--type`, `-type`, `--name`, `-name`, `--max-depth`, `-maxdepth`, `-type f`, `-type d` | yes           | No boolean expressions, `-exec`, `-print0`, or regex predicates                             |
| `grep`  | `-i`, `-v`, `-c`, `-n`, `-F`, `-E`, `-o`, `-w`, `-x`, `-q`                             | yes           | Recursive traversal flags such as `-R` are still out of scope                               |
| `head`  | `-n N`, `-c N`, legacy `-N`, attached `-nN`, attached `-cN`                            | yes           | Works on rooted files or stdin only                                                         |
| `tail`  | `-n N`, `-c N`, legacy `-N`, attached `-nN`, attached `-cN`                            | yes           | Works on rooted files or stdin only                                                         |
| `sort`  | `-r`, `-n`, `-u`, `-f`, `-V`                                                           | yes           | No key-based sorting or locale-specific collation modes                                     |
| `uniq`  | `-c`, `-d`, `-i`, `-u`                                                                 | yes           | Applies to adjacent groups only, like GNU `uniq`                                            |
| `wc`    | `-l`, `-w`, `-c`                                                                       | yes           | Field order follows GNU `wc`; line counts follow newline counts                             |
| `sed`   | GNU-style subset with `-n`, `-e`, `-f`, `-E`, `-i[SUFFIX]` and clustered short options | yes           | See command help for the supported editing commands and addressing subset                   |
| `tr`    | GNU-style translate, delete, squeeze, complement, range, repeat, and class subset      | yes           | Byte-oriented parity is measured under `LC_ALL=C`                                           |
| `diff`  | `-u`, `-U N`, `-c`, `-C N`, `-r`, `-a`, `-b`, `-i`                                     | yes           | Rooted VFS semantics still apply                                                            |

## Intentional global differences

These commands stay within one-tool’s runtime model even when they accept familiar GNU-style flags:

- paths are always rooted under `/`
- there is no current working directory
- shell glob expansion does not happen before command parsing
- redirection and process execution are not supported
- runtime output limits, binary guards, and VFS policy limits still apply
