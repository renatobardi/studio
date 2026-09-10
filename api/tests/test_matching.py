"""RED: NIP-01 filter matching is pure Python, no database involved.

Semantics under test (NIP-01):
- Within one filter, every present attribute must match (AND).
- Across multiple filters, an event matches if any filter matches (OR).
- Tag filters (`#e`, `#p`, `#h`, ...) match if the event has at least one tag
  of that name whose value is in the filter's list.
- `since`/`until` are inclusive bounds on `created_at`.
"""

from studio_api.nostr.matching import event_matches_filter, event_matches_filters
from studio_api.nostr.model import Filter, NostrEvent


def make_event(**overrides: object) -> NostrEvent:
    base: NostrEvent = {
        "id": "a" * 64,
        "pubkey": "b" * 64,
        "created_at": 1_000,
        "kind": 1,
        "tags": [],
        "content": "hello",
        "sig": "c" * 128,
    }
    base.update(overrides)  # type: ignore[typeddict-item]
    return base


def test_empty_filter_matches_everything() -> None:
    assert event_matches_filter(make_event(), Filter())


def test_ids_filter_matches_only_listed_ids() -> None:
    event = make_event(id="a" * 64)
    assert event_matches_filter(event, Filter(ids=["a" * 64, "d" * 64]))
    assert not event_matches_filter(event, Filter(ids=["d" * 64]))


def test_authors_filter() -> None:
    event = make_event(pubkey="b" * 64)
    assert event_matches_filter(event, Filter(authors=["b" * 64]))
    assert not event_matches_filter(event, Filter(authors=["e" * 64]))


def test_kinds_filter() -> None:
    event = make_event(kind=9)
    assert event_matches_filter(event, Filter(kinds=[1, 9]))
    assert not event_matches_filter(event, Filter(kinds=[1, 11]))


def test_tag_filter_matches_first_value_of_named_tag() -> None:
    event = make_event(tags=[["e", "target-id", "wss://relay"], ["p", "someone"]])
    assert event_matches_filter(event, Filter(tags={"e": ["target-id"]}))
    assert event_matches_filter(event, Filter(tags={"p": ["someone"]}))
    assert not event_matches_filter(event, Filter(tags={"e": ["other-id"]}))


def test_tag_filter_with_no_matching_tag_name_fails() -> None:
    event = make_event(tags=[["p", "someone"]])
    assert not event_matches_filter(event, Filter(tags={"e": ["someone"]}))


def test_multiple_tag_filters_are_anded() -> None:
    event = make_event(tags=[["e", "id1"], ["p", "pub1"]])
    assert event_matches_filter(event, Filter(tags={"e": ["id1"], "p": ["pub1"]}))
    assert not event_matches_filter(event, Filter(tags={"e": ["id1"], "p": ["pub2"]}))


def test_since_is_inclusive_lower_bound() -> None:
    event = make_event(created_at=1_000)
    assert event_matches_filter(event, Filter(since=1_000))
    assert event_matches_filter(event, Filter(since=999))
    assert not event_matches_filter(event, Filter(since=1_001))


def test_until_is_inclusive_upper_bound() -> None:
    event = make_event(created_at=1_000)
    assert event_matches_filter(event, Filter(until=1_000))
    assert event_matches_filter(event, Filter(until=1_001))
    assert not event_matches_filter(event, Filter(until=999))


def test_all_conditions_in_one_filter_are_anded() -> None:
    event = make_event(pubkey="b" * 64, kind=1, created_at=1_000)
    matching = Filter(authors=["b" * 64], kinds=[1], since=500, until=1_500)
    assert event_matches_filter(event, matching)

    wrong_kind = Filter(authors=["b" * 64], kinds=[9], since=500, until=1_500)
    assert not event_matches_filter(event, wrong_kind)


def test_limit_is_not_a_matching_condition() -> None:
    # `limit` only guides the initial historical query, per NIP-01 — it plays
    # no role in whether a single event matches a filter.
    event = make_event()
    assert event_matches_filter(event, Filter(limit=0))


def test_multiple_filters_are_ored() -> None:
    event = make_event(kind=9)
    filters = [Filter(kinds=[1]), Filter(kinds=[9])]
    assert event_matches_filters(event, filters)


def test_no_filters_at_all_matches_nothing() -> None:
    # A subscription must declare at least one filter; zero filters describes
    # no subscription, so nothing should be delivered.
    assert not event_matches_filters(make_event(), [])


def test_none_of_the_ored_filters_matches() -> None:
    event = make_event(kind=1)
    filters = [Filter(kinds=[9]), Filter(authors=["z" * 64])]
    assert not event_matches_filters(event, filters)
