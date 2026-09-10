"""Pure-Python NIP-01 filter matching.

This is the core of the live-fan-out spike (ADR-0004): a single `LIVE
SELECT` on the event table yields a stream of newly-written events, and each
one is matched in-process against every open subscription's filters, rather
than re-querying the database per subscription.
"""

from studio_api.nostr.model import Filter, NostrEvent


def event_matches_filter(event: NostrEvent, flt: Filter) -> bool:
    if flt.ids is not None and event["id"] not in flt.ids:
        return False
    if flt.authors is not None and event["pubkey"] not in flt.authors:
        return False
    if flt.kinds is not None and event["kind"] not in flt.kinds:
        return False
    if flt.since is not None and event["created_at"] < flt.since:
        return False
    if flt.until is not None and event["created_at"] > flt.until:
        return False
    for tag_name, wanted_values in flt.tags.items():
        if not _has_matching_tag(event, tag_name, wanted_values):
            return False
    return True


def event_matches_filters(event: NostrEvent, filters: list[Filter]) -> bool:
    return any(event_matches_filter(event, flt) for flt in filters)


def _has_matching_tag(event: NostrEvent, tag_name: str, wanted_values: list[str]) -> bool:
    for tag in event["tags"]:
        if len(tag) >= 2 and tag[0] == tag_name and tag[1] in wanted_values:
            return True
    return False
