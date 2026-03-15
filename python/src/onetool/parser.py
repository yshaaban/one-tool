from __future__ import annotations

from dataclasses import asdict, dataclass


class ParseError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class SimpleCommandNode:
    argv: list[str]


@dataclass(frozen=True, slots=True)
class PipelineNode:
    commands: list[SimpleCommandNode]


@dataclass(frozen=True, slots=True)
class ChainNode:
    relation_from_previous: str | None
    pipeline: PipelineNode


def tokenize_command_line(command_line: str) -> list[str]:
    if not command_line.strip():
        raise ParseError("empty command string")

    tokens: list[str] = []
    current: list[str] = []
    quote: str | None = None
    index = 0

    while index < len(command_line):
        char = command_line[index]
        next_char = command_line[index + 1] if index + 1 < len(command_line) else None

        if quote is not None:
            if char == quote:
                quote = None
                index += 1
                continue
            if quote == '"' and char == "\\" and next_char is not None:
                current.append(next_char)
                index += 2
                continue
            current.append(char)
            index += 1
            continue

        if char.isspace():
            _flush_current(tokens, current)
            index += 1
            continue

        if char in {"'", '"'}:
            quote = char
            index += 1
            continue

        if char == "\\":
            if next_char is None:
                raise ParseError("dangling escape at end of command")
            current.append(next_char)
            index += 2
            continue

        if char == "`" or (char == "$" and next_char == "("):
            raise ParseError(
                "command substitution is not supported. Compose commands explicitly with pipes and files."
            )

        if char in {">", "<"}:
            raise ParseError(
                f"redirection operator '{char}' is not supported. Use pipes plus write/append instead."
            )

        if char == "&":
            _flush_current(tokens, current)
            if next_char == "&":
                tokens.append("&&")
                index += 2
                continue
            raise ParseError("background operator '&' is not supported. Use ';' or explicit chaining instead.")

        if char == "|":
            _flush_current(tokens, current)
            if next_char == "|":
                tokens.append("||")
                index += 2
            else:
                tokens.append("|")
                index += 1
            continue

        if char == ";":
            _flush_current(tokens, current)
            tokens.append(";")
            index += 1
            continue

        current.append(char)
        index += 1

    if quote is not None:
        raise ParseError(f"unterminated {quote} quote")

    _flush_current(tokens, current)

    if not tokens:
        raise ParseError("empty command string")

    return tokens


def parse_command_line(command_line: str) -> list[ChainNode]:
    tokens = tokenize_command_line(command_line)

    chain: list[ChainNode] = []
    current_pipeline: list[SimpleCommandNode] = []
    current_argv: list[str] = []
    relation_from_previous: str | None = None

    def flush_command() -> None:
        nonlocal current_argv
        if not current_argv:
            raise ParseError("unexpected operator")
        current_pipeline.append(SimpleCommandNode(argv=current_argv))
        current_argv = []

    def flush_pipeline(next_relation: str | None) -> None:
        nonlocal current_pipeline
        nonlocal relation_from_previous
        flush_command()
        chain.append(
            ChainNode(
                relation_from_previous=relation_from_previous,
                pipeline=PipelineNode(commands=current_pipeline),
            )
        )
        current_pipeline = []
        relation_from_previous = next_relation

    for token in tokens:
        if token == "|":
            flush_command()
            continue
        if token in {"&&", "||", ";"}:
            flush_pipeline(token)
            continue
        current_argv.append(token)

    if not current_argv:
        raise ParseError("unexpected end of command")

    current_pipeline.append(SimpleCommandNode(argv=current_argv))
    chain.append(
        ChainNode(
            relation_from_previous=relation_from_previous,
            pipeline=PipelineNode(commands=current_pipeline),
        )
    )
    return chain


def chain_to_dict(chain: list[ChainNode]) -> list[dict[str, object]]:
    return [asdict(node) for node in chain]


def _flush_current(tokens: list[str], current: list[str]) -> None:
    if current:
        tokens.append("".join(current))
        current.clear()
