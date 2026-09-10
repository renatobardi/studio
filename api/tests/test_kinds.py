"""RED: NIP-01 kind-range classification.

Ranges (NIP-01):
- regular:      1000<=n<10000 || 4<=n<45 || n in (1, 2)
- replaceable:  10000<=n<20000 || n in (0, 3)
- ephemeral:    20000<=n<30000
- addressable:  30000<=n<40000
Anything else falls back to "regular" (relays store it unless told otherwise).
"""

from studio_api.nostr.kinds import KindClass, kind_class


def test_explicit_regular_kinds() -> None:
    assert kind_class(1) == KindClass.REGULAR
    assert kind_class(2) == KindClass.REGULAR
    assert kind_class(9) == KindClass.REGULAR  # 4 <= 9 < 45
    assert kind_class(1111) == KindClass.REGULAR  # 1000 <= n < 10000


def test_replaceable_kinds() -> None:
    assert kind_class(0) == KindClass.REPLACEABLE
    assert kind_class(3) == KindClass.REPLACEABLE
    assert kind_class(10_002) == KindClass.REPLACEABLE


def test_ephemeral_kinds() -> None:
    assert kind_class(20_000) == KindClass.EPHEMERAL
    assert kind_class(22_242) == KindClass.EPHEMERAL


def test_addressable_kinds() -> None:
    assert kind_class(30_023) == KindClass.ADDRESSABLE
    assert kind_class(39_999) == KindClass.ADDRESSABLE


def test_undefined_ranges_fall_back_to_regular() -> None:
    assert kind_class(46) == KindClass.REGULAR
    assert kind_class(999) == KindClass.REGULAR
    assert kind_class(40_000) == KindClass.REGULAR


def test_range_boundaries() -> None:
    assert kind_class(9_999) == KindClass.REGULAR
    assert kind_class(10_000) == KindClass.REPLACEABLE
    assert kind_class(19_999) == KindClass.REPLACEABLE
    assert kind_class(29_999) == KindClass.EPHEMERAL
    assert kind_class(30_000) == KindClass.ADDRESSABLE
