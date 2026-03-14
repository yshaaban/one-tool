# GNU-style compatibility matrix

This matrix summarizes the supported GNU-style subset for the built-in commands that currently use oracle-backed parity tests.

For the overall target and oracle approach, see [`gnu-command-parity.md`](./gnu-command-parity.md).

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
