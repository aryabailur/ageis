"""Generic MCP tool caller used by every node that needs a peer service.

This is the one place the orchestrator speaks the MCP wire protocol. Nodes
never import a service's client directly — they resolve it by name/tool
through the shared ServiceRegistry and call `call_tool`, so attaching a
new data/routing plugin never touches node code.
"""

from __future__ import annotations

import json
from typing import Any

from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


async def call_tool(base_url: str, tool_name: str, arguments: dict[str, Any]) -> Any:
    mcp_url = base_url.rstrip("/") + "/mcp"
    async with streamable_http_client(mcp_url) as (read, write, _get_session_id):
        async with ClientSession(read, write) as session:
            await session.initialize()
            result = await session.call_tool(tool_name, arguments)
            if result.isError:
                raise RuntimeError(f"MCP tool '{tool_name}' returned an error: {result.content}")
            if result.structuredContent is not None:
                # FastMCP wraps non-object returns (e.g. a bare list) as
                # {"result": [...]} because MCP structured content must be
                # a JSON object; unwrap that one specific shape back to the
                # tool's real return value.
                if set(result.structuredContent.keys()) == {"result"}:
                    return result.structuredContent["result"]
                return result.structuredContent
            for block in result.content:
                if getattr(block, "type", None) == "text":
                    return json.loads(block.text)
            raise RuntimeError(f"MCP tool '{tool_name}' returned no usable content")
