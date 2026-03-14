# Command Reference

Complete reference for the built-in command language and built-in command surface.

For the top-level overview, start with [`../README.md`](../README.md). For API details, see [`api.md`](api.md).

For the GNU-style subset we support and the oracle-backed compatibility target, see:

- [`parity/gnu-command-parity.md`](parity/gnu-command-parity.md)
- [`parity/compatibility-matrix.md`](parity/compatibility-matrix.md)

## Compatibility intent

Built-in commands fall into three groups:

- **GNU-style subset** — `echo`, `ls`, `find`, `grep`, `head`, `tail`, `sort`, `uniq`, `wc`, `sed`, `tr`, and `diff` aim for a measured subset of familiar GNU/Linux behavior.
- **Unix-inspired, product-shaped** — `stat`, `cat`, `mkdir`, `cp`, `mv`, and `rm` use familiar CLI shapes, but their behavior is defined by one-tool's rooted workspace and safety rules.
- **Product-native** — `help`, `memory`, `write`, `append`, `json`, `calc`, `search`, and `fetch` are part of the one-tool runtime model and do not aim for GNU/Linux compatibility.

If a command is in the GNU-style subset, the parity docs define the supported forms. Otherwise, this reference and `help <command>` are the authoritative contract.

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

The runtime ships with 26 built-in commands.

### System commands

| Command  | Usage                                                                                                                | Stdin | Purpose                                                    |
| -------- | -------------------------------------------------------------------------------------------------------------------- | ----: | ---------------------------------------------------------- |
| `help`   | `help [command]`                                                                                                     |    no | List commands or show detailed help                        |
| `memory` | <code>memory search &lt;query&gt;</code><br><code>memory recent [N]</code><br><code>memory store &lt;text&gt;</code> |   yes | Store and search lightweight runtime-scoped working memory |

Examples:

```text
help grep
memory store "Acme prefers Monday follow-ups"
memory search "Acme"
memory recent 5
```

### Filesystem commands

| Command  | Usage                                                                                                                                          | Stdin | Purpose                                                        |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----: | -------------------------------------------------------------- |
| `ls`     | `ls [-1aRl] [path]`                                                                                                                            |    no | List files or directories                                      |
| `stat`   | `stat <path>`                                                                                                                                  |    no | Show one-tool workspace metadata for a path                    |
| `cat`    | `cat [path ...\|-]`                                                                                                                            |   yes | Read text from rooted files, or splice piped stdin with `-`    |
| `write`  | `write <path> [content]`                                                                                                                       |   yes | Write a file from inline content or stdin                      |
| `append` | `append <path> [content]`                                                                                                                      |   yes | Append to a file                                               |
| `mkdir`  | `mkdir [-p] <path>`                                                                                                                            |    no | Create a directory and missing parents                         |
| `cp`     | `cp <src> <dst>`                                                                                                                               |    no | Copy a file or directory to a new rooted destination           |
| `diff`   | `diff [-u\|-U N\|-c\|-C N] [-r] [-a] [-b] [-i] <left> <right>`                                                                                 |   yes | Compare files or directories                                   |
| `mv`     | `mv <src> <dst>`                                                                                                                               |    no | Move or rename a file or directory to a new rooted destination |
| `rm`     | `rm [-r\|-R] <path>`                                                                                                                           |    no | Delete a file or directory recursively                         |
| `find`   | <code>find [path] [--type file&#124;dir&#124;-type f&#124;-type d] [--name pattern&#124;-name pattern] [--max-depth N&#124;-maxdepth N]</code> |    no | Recursively list files and directories                         |

Examples:

```text
ls /
ls -a /
ls -R /logs
stat /logs/app.log
cat /notes/todo.txt
cat /notes/a.txt /notes/b.txt
grep ERROR /logs/app.log | cat
grep ERROR /logs/app.log | cat /notes/header.txt -
write /reports/summary.txt "ready"
cat /logs/app.log | grep ERROR | write /reports/errors.txt
append /reports/summary.txt "next line"
mkdir /reports/daily/2026-03-13
mkdir -p /reports/daily/2026-03-13
cp /drafts/qbr.md /reports/qbr-v1.md
diff -u /drafts/qbr.md /reports/qbr-v2.md
mv /reports/qbr-v1.md /archive/qbr.md
rm /scratch
rm -r /scratch
find /config -type f -name "*.json"
```

### Text commands

| Command | Usage                                                                     | Stdin | Purpose                                                                                 |
| ------- | ------------------------------------------------------------------------- | ----: | --------------------------------------------------------------------------------------- |
| `echo`  | `echo [-n] [-e\|-E] [text ...]`                                           |    no | Write arguments back as plain text output                                               |
| `grep`  | `grep [-i] [-v] [-c] [-n] [-F] [-E] [-o] [-w] [-x] [-q] <pattern> [path]` |   yes | Filter lines by pattern                                                                 |
| `head`  | `head [-n N\|-c N\|-N] [path]`                                            |   yes | Show first N lines or bytes                                                             |
| `tail`  | `tail [-n N\|-c N\|-N] [path]`                                            |   yes | Show last N lines or bytes                                                              |
| `sort`  | `sort [-r] [-n] [-u] [-f] [-V] [path]`                                    |   yes | Sort lines                                                                              |
| `sed`   | `sed [OPTION]... [SCRIPT] [INPUTFILE...]`                                 |   yes | Run a GNU-compatible `sed` subset with `p`, `d`, `q`, `n`, `s`, `a`, `i`, `c`, and `-i` |
| `tr`    | `tr [OPTION]... STRING1 [STRING2]`                                        |   yes | Translate, delete, or squeeze bytes from stdin                                          |
| `uniq`  | `uniq [-c] [-d] [-i] [-u] [path]`                                         |   yes | Collapse adjacent duplicate lines, or select duplicate-only / unique-only groups        |
| `wc`    | `wc [-l] [-w] [-c] [path]`                                                |   yes | Count lines, words, and bytes in GNU-style field order                                  |

Examples:

```text
echo "ready for review"
echo -e "line 1\nline 2"
grep ERROR /logs/app.log
grep -F -o timeout /logs/app.log
cat /logs/app.log | grep -i timeout
head -n 20 /logs/app.log
head -5 /logs/app.log
head -c 16 /notes/todo.txt
tail -n 50 /logs/app.log
tail -2 /logs/app.log
tail -c 16 /notes/todo.txt
find /config -type f | sort
sort -f /tmp/names.txt
sort -V /tmp/releases.txt
sed -n '1,20p' /logs/app.log
sed -ne '2p' /logs/app.log
sed -i.bak 's/us-east-1/us-west-2/' /config/app.env
cat /notes/todo.txt | tr a-z A-Z
cat /logs/app.log | sort | uniq -c
sort /logs/errors.txt | uniq -d
sort /logs/errors.txt | uniq -u
wc -l /logs/app.log
fetch text:runbook | wc -w
```

### Data commands

| Command | Usage                                                                                                               | Stdin | Purpose                                             |
| ------- | ------------------------------------------------------------------------------------------------------------------- | ----: | --------------------------------------------------- |
| `json`  | <code>json pretty [path]</code><br><code>json keys [path]</code><br><code>json get &lt;field.path&gt; [path]</code> |   yes | Inspect JSON with a small dot-and-index path syntax |
| `calc`  | `calc <expression>`                                                                                                 |    no | Evaluate safe arithmetic only                       |

Examples:

```text
fetch order:123 | json pretty
fetch order:123 | json get customer.email
json keys /config/prod.json
calc (1499 * 1.2) / 100
```

### Adapter-backed commands

| Command  | Usage              | Stdin | Purpose                                                            |
| -------- | ------------------ | ----: | ------------------------------------------------------------------ |
| `search` | `search <query>`   |    no | Query the configured search adapter and format the top results     |
| `fetch`  | `fetch <resource>` |    no | Query the configured fetch adapter and render the returned payload |

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
find /config -type f -name "*.json" | sort
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
find /config -type f -name "*.json" | wc -w
```
