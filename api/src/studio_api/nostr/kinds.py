"""NIP-01 kind-range classification."""

from enum import Enum


class KindClass(Enum):
    REGULAR = "regular"
    REPLACEABLE = "replaceable"
    EPHEMERAL = "ephemeral"
    ADDRESSABLE = "addressable"


def kind_class(kind: int) -> KindClass:
    if kind in (0, 3) or 10_000 <= kind < 20_000:
        return KindClass.REPLACEABLE
    if 20_000 <= kind < 30_000:
        return KindClass.EPHEMERAL
    if 30_000 <= kind < 40_000:
        return KindClass.ADDRESSABLE
    return KindClass.REGULAR
