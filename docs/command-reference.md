# Command Reference

Complete reference for the built-in command language and built-in command surface.

For the top-level overview, start with [`../README.md`](../README.md). For API details, see [`api.md`](api.md).

---

## Command language

### Supported operators

| Operator            | Meaning                                                  |
| ------------------- | -------------------------------------------------------- |
| `<code>\|</code>`   | pipe stdout to the next command                          |
| `&&`                | run the next pipeline only if the previous one succeeded |
| `<code>\|\|</code>` | run the next pipeline only if the previous one failed    |
| `;`                 | always run the next pipeline                             |

Examples:

```text
cat /logs/app.log | grep ERROR | tail -n 20
cat /config/prod.json || cat /config/default.json
search "EU VAT" | head -n 5 | write /research/vat.txt
cp /drafts/qbr.md /reports/qbr-v1.md && ls /reports
```

### Quoting and escaping

The parser supports:

- single quotes
- double quotes
- backslash escaping

Examples:

```text
write /notes/todo.txt "line with spaces"
grep "payment timeout" /logs/app.log
calc (12 * 8) / 3
```

### Intentionally unsupported

This is not a real shell.

The parser rejects or does not implement:

- environment expansion
- globbing
- command substitution
- redirection
- backgrounding

Examples that are intentionally rejected:

```text
cat /logs/app.log > out.txt
echo $(whoami)
grep ERROR /logs/*.log
long_task &
```

Use command composition plus virtual files instead:

```text
cat /logs/app.log | grep ERROR | write /reports/errors.txt
```

### Path semantics

All command paths are rooted:

```text
/notes/todo.txt
/logs/app.log
/config/prod.json
```

Relative paths also resolve under `/`:

```text
notes/todo.txt   -> /notes/todo.txt
logs/app.log     -> /logs/app.log
```

There is no mutable current working directory.

---

## Built-in commands

The runtime ships with 25 built-in commands.

### System commands

| Command  | Usage                                                                                                                | Stdin | Purpose                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------- | ----: | ------------------------------------------- |
| `help`   | `help [command]`                                                                                                     |    no | List commands or show detailed help         |
| `memory` | <code>memory search &lt;query&gt;</code><br><code>memory recent [N]</code><br><code>memory store &lt;text&gt;</code> |   yes | Store and search lightweight working memory |

Examples:

```text
help grep
memory store "Acme prefers Monday follow-ups"
memory search "Acme"
memory recent 5
```

### Filesystem commands

| Command  | Usage                                                                            | Stdin | Purpose                                   |
| -------- | -------------------------------------------------------------------------------- | ----: | ----------------------------------------- |
| `ls`     | `ls [path]`                                                                      |    no | List a directory                          |
| `stat`   | `stat <path>`                                                                    |    no | Show file metadata                        |
| `cat`    | `cat <path>`                                                                     |    no | Read a text file                          |
| `write`  | `write <path> [content]`                                                         |   yes | Write a file from inline content or stdin |
| `append` | `append <path> [content]`                                                        |   yes | Append to a file                          |
| `mkdir`  | `mkdir <path>`                                                                   |    no | Create a directory and missing parents    |
| `cp`     | `cp <src> <dst>`                                                                 |    no | Copy a file or directory                  |
| `diff`   | `diff [-u\|-U N\|-c\|-C N] [-r] [-a] [-b] [-i] <left> <right>`                   |   yes | Compare files or directories              |
| `mv`     | `mv <src> <dst>`                                                                 |    no | Move or rename a file or directory        |
| `rm`     | `rm <path>`                                                                      |    no | Delete a file or directory recursively    |
| `find`   | <code>find [path] [--type file&#124;dir] [--name pattern] [--max-depth N]</code> |    no | Recursively list files and directories    |

Examples:

```text
ls /
stat /logs/app.log
cat /notes/todo.txt
write /reports/summary.txt "ready"
cat /logs/app.log | grep ERROR | write /reports/errors.txt
append /reports/summary.txt "next line"
mkdir /reports/daily/2026-03-13
cp /drafts/qbr.md /reports/qbr-v1.md
diff -u /drafts/qbr.md /reports/qbr-v2.md
mv /reports/qbr-v1.md /archive/qbr.md
rm /scratch
find /config --type file --name "*.json"
```

### Text commands

| Command | Usage                                       | Stdin | Purpose                                                                       |
| ------- | ------------------------------------------- | ----: | ----------------------------------------------------------------------------- |
| `grep`  | `grep [-i] [-v] [-c] [-n] <pattern> [path]` |   yes | Filter lines by regex                                                         |
| `head`  | `head [-n N] [path]`                        |   yes | Show first N lines                                                            |
| `tail`  | `tail [-n N] [path]`                        |   yes | Show last N lines                                                             |
| `sort`  | `sort [-r] [-n] [-u] [path]`                |   yes | Sort lines                                                                    |
| `sed`   | `sed [OPTION]... [SCRIPT] [INPUTFILE...]`   |   yes | Run stream-edit scripts with `p`, `d`, `q`, `n`, `s`, `a`, `i`, `c`, and `-i` |
| `tr`    | `tr [OPTION]... STRING1 [STRING2]`          |   yes | Translate, delete, or squeeze bytes from stdin                                |
| `uniq`  | `uniq [-c] [-i] [path]`                     |   yes | Collapse adjacent duplicate lines                                             |
| `wc`    | `wc [-l] [-w] [-c] [path]`                  |   yes | Count lines, words, and bytes                                                 |

Examples:

```text
grep ERROR /logs/app.log
cat /logs/app.log | grep -i timeout
head -n 20 /logs/app.log
tail -n 50 /logs/app.log
find /config --type file | sort
sed -n '1,20p' /logs/app.log
sed -i.bak 's/us-east-1/us-west-2/' /config/app.env
cat /notes/todo.txt | tr a-z A-Z
cat /logs/app.log | sort | uniq -c
wc -l /logs/app.log
```

### Data commands

| Command | Usage                                                                                                               | Stdin | Purpose                  |
| ------- | ------------------------------------------------------------------------------------------------------------------- | ----: | ------------------------ |
| `json`  | <code>json pretty [path]</code><br><code>json keys [path]</code><br><code>json get &lt;field.path&gt; [path]</code> |   yes | Inspect JSON             |
| `calc`  | `calc <expression>`                                                                                                 |    no | Evaluate safe arithmetic |

Examples:

```text
fetch order:123 | json pretty
fetch order:123 | json get customer.email
json keys /config/prod.json
calc (1499 * 1.2) / 100
```

### Adapter-backed commands

| Command  | Usage              | Stdin | Purpose                             |
| -------- | ------------------ | ----: | ----------------------------------- |
| `search` | `search <query>`   |    no | Query the configured search adapter |
| `fetch`  | `fetch <resource>` |    no | Query the configured fetch adapter  |

Examples:

```text
search "refund timeout incident"
fetch order:123
fetch crm/customer/acme | json get owner.email
```

---

## Realistic workflows

### Log triage

```text
cat /logs/app.log | grep ERROR | tail -n 20
```

### Inventory config files

```text
find /config --type file --name "*.json" | sort
```

### Fallback config inspection

```text
cat /config/prod.json || cat /config/default.json
```

### Search, distill, and persist

```text
search "Acme renewal risk" | head -n 5 | write /notes/acme-risk.txt
```

### Structured fetch plus extraction

```text
fetch order:123 | json get customer.email
```

### Memory loop

```text
cat /accounts/acme.md | head -n 3 | memory store
memory search "Acme owner"
```

### Count discovered files

```text
find /config --type file --name "*.json" | wc -l
```
