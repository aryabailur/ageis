"""Generic MCP tool caller used by every node that needs a peer service.

This is the one place the orchestrator speaks the MCP wire protocol. Nodes
never import a service's client directly — they resolve it by name/tool
through the shared ServiceRegistry and call `call_tool`, so attaching a
new data/routing plugin never touches node code.

Sessions are held open and reused per (base_url, event loop) rather than
opened fresh for every single tool call. Standing up a new streamable-http
session (handshake, SSE stream negotiation, teardown) on every call turned
out to be where a real transport-level race lived -- under load it would
intermittently raise inside the SSE reader's background task, bypassing
the plain try/except in call_with_fallback's caller entirely on some runs.
A session that's already established and gets reused doesn't hit that
negotiation path per call, and the rare failure that still slips through
discards the session so the next call gets a clean one.

The event loop is part of the cache key, not just base_url: a session's
underlying anyio task group is bound to the task/loop that created it, so
reusing (or even closing) it from a different loop raises "Attempted to
exit cancel scope in a different task than it was entered in". In the
real long-running server there's exactly one loop for the process's whole
life, so this never matters there -- it only bites under something like
pytest-asyncio, which hands each test function a fresh loop. When the
running loop doesn't match the cached one, we simply drop the stale
reference (never close it from the wrong loop) and negotiate fresh.
"""

from __future__ import annotations

import asyncio
import json
from contextlib import AsyncExitStack
from typing import Any

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

_sessions: dict[str, tuple[asyncio.AbstractEventLoop, ClientSession, AsyncExitStack]] = {}
_lock = asyncio.Lock()


def _cached_for_current_loop(base_url: str) -> ClientSession | None:
    entry = _sessions.get(base_url)
    if entry is None:
        return None
    loop, session, _stack = entry
    if loop is not asyncio.get_running_loop():
        _sessions.pop(base_url, None)  # stale from a dead loop; never close it here
        return None
    return session


async def _get_session(base_url: str) -> ClientSession:
    session = _cached_for_current_loop(base_url)
    if session is not None:
        return session

    async with _lock:
        session = _cached_for_current_loop(base_url)
        if session is not None:
            return session

        stack = AsyncExitStack()
        mcp_url = base_url.rstrip("/") + "/mcp"
        read, write, _get_session_id = await stack.enter_async_context(streamable_http_client(mcp_url))
        session = await stack.enter_async_context(ClientSession(read, write))
        await session.initialize()
        _sessions[base_url] = (asyncio.get_running_loop(), session, stack)
        return session


async def _discard_session(base_url: str) -> None:
    entry = _sessions.get(base_url)
    if entry is None:
        return
    loop, _session, stack = entry
    if loop is not asyncio.get_running_loop():
        # Not ours to close -- pop the reference and move on.
        _sessions.pop(base_url, None)
        return
    _sessions.pop(base_url, None)
    try:
        await stack.aclose()
    except Exception:  # noqa: BLE001 - already broken, just drop it
        pass


async def close_sessions_for_current_loop() -> None:
    """Explicitly tears down every cached session that belongs to the
    currently running loop. Call this before that loop closes (e.g. an
    autouse pytest fixture's teardown) -- an async generator abandoned
    without an explicit aclose() gets finalized by Python's GC in
    whatever loop happens to be running *later*, which is exactly the
    cross-task cancel-scope crash this module exists to avoid."""
    current_loop = asyncio.get_running_loop()
    for base_url, (loop, _session, _stack) in list(_sessions.items()):
        if loop is current_loop:
            await _discard_session(base_url)


async def call_tool(base_url: str, tool_name: str, arguments: dict[str, Any]) -> Any:
    session = await _get_session(base_url)
    try:
        result = await session.call_tool(tool_name, arguments)
    except Exception:
        # The session may be dead (closed transport, expired server-side
        # state); drop it so the next call negotiates a fresh one instead
        # of retrying against something we know is broken.
        await _discard_session(base_url)
        raise

    if result.isError:
        raise RuntimeError(f"MCP tool '{tool_name}' returned an error: {result.content}")
    if result.structuredContent is not None:
        # FastMCP wraps non-object returns (e.g. a bare list) as
        # {"result": [...]} because MCP structured content must be a JSON
        # object; unwrap that one specific shape back to the tool's real
        # return value.
        if set(result.structuredContent.keys()) == {"result"}:
            return result.structuredContent["result"]
        return result.structuredContent
    for block in result.content:
        if getattr(block, "type", None) == "text":
            return json.loads(block.text)
    raise RuntimeError(f"MCP tool '{tool_name}' returned no usable content")
