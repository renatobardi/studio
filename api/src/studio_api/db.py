"""Small SurrealDB read helpers shared by every repository (control-plane,
media): a table nothing has been written to yet raises NotFoundError on
select/query rather than returning empty — that's just "nothing there yet"
for our purposes."""

from typing import Any

from surrealdb.data.types.record_id import RecordID
from surrealdb.errors import NotFoundError


async def select_or_none(db: Any, record_id: RecordID) -> dict[str, Any] | None:
    try:
        rows = await db.select(record_id)
    except NotFoundError:
        return None
    return rows[0] if rows else None


async def query_or_empty(db: Any, surql: str, params: dict[str, Any]) -> list[dict[str, Any]]:
    try:
        rows: list[dict[str, Any]] = await db.query(surql, params)
    except NotFoundError:
        return []
    return rows
