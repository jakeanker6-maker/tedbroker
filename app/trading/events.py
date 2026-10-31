"""Per-user account event fan-out for the /api/stream/account SSE endpoint.

Producers (the ledger today; orders/fills/positions in Phase 2) call `publish()`
from any thread. Events are delivered on the event loop to every open stream of
that user. Queues are bounded; a slow client drops its oldest events.
"""
from __future__ import annotations

import asyncio
from typing import Any, Dict, Optional, Set

_loop: Optional[asyncio.AbstractEventLoop] = None
_streams: Dict[str, Set[asyncio.Queue]] = {}
QUEUE_SIZE = 200


def bind_loop(loop: asyncio.AbstractEventLoop) -> None:
    global _loop
    _loop = loop


def open_stream(user_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_SIZE)
    _streams.setdefault(str(user_id), set()).add(q)
    return q


def close_stream(user_id: str, q: asyncio.Queue) -> None:
    s = _streams.get(str(user_id))
    if s:
        s.discard(q)
        if not s:
            _streams.pop(str(user_id), None)


def _deliver(user_id: str, event: Dict[str, Any]) -> None:
    for q in list(_streams.get(user_id, ())):
        if q.full():
            try:
                q.get_nowait()
            except asyncio.QueueEmpty:
                pass
        q.put_nowait(event)


def publish(user_id: str, kind: str, data: Dict[str, Any]) -> None:
    uid = str(user_id)
    if uid not in _streams:
        return
    event = {"event": kind, "data": data}
    loop = _loop
    if loop is None or loop.is_closed():
        return
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if running is loop:
        _deliver(uid, event)
    else:
        loop.call_soon_threadsafe(_deliver, uid, event)


def on_ledger_entry(entry: Dict[str, Any]) -> None:
    """Ledger listener: push the new balances after every posting."""
    cash = int(entry.get("cash_after_cents", 0))
    reserved = int(entry.get("reserved_after_cents", 0))
    publish(entry["user_id"], "balance", {
        "cash": f"{cash / 100:.2f}",
        "reserved": f"{reserved / 100:.2f}",
        "available": f"{(cash - reserved) / 100:.2f}",
        "reason": entry.get("type"),
        "description": entry.get("description"),
    })
