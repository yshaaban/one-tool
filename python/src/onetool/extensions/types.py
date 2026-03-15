from __future__ import annotations

from dataclasses import dataclass
from typing import Generic, TypeVar

from ..types import CommandResult

T = TypeVar("T")


@dataclass(frozen=True, slots=True)
class HelperResult(Generic[T]):
    ok: bool
    value: T | None = None
    error: CommandResult | None = None


def helper_success(value: T) -> HelperResult[T]:
    return HelperResult(ok=True, value=value)


def helper_failure(error: CommandResult) -> HelperResult[T]:
    return HelperResult(ok=False, error=error)
