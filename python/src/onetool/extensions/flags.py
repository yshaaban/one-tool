from __future__ import annotations

from dataclasses import dataclass

from ..types import err
from .types import HelperResult, helper_failure, helper_success


@dataclass(frozen=True, slots=True)
class ParsedCountFlag:
    count: int
    rest: list[str]


def parse_count_flag(
    command_name: str,
    args: list[str],
    default_count: int,
) -> HelperResult[ParsedCountFlag]:
    if not args or args[0] != "-n":
        return helper_success(ParsedCountFlag(count=default_count, rest=list(args)))

    if len(args) < 2:
        return helper_failure(err(f"{command_name}: missing value for -n"))

    try:
        count = int(args[1], 10)
    except ValueError:
        return helper_failure(err(f"{command_name}: invalid integer for -n: {args[1]}"))

    return helper_success(ParsedCountFlag(count=count, rest=args[2:]))
