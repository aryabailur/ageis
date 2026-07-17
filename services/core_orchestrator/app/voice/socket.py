"""Minimal FastAPI-native replacement for what a Socket.io "room" would
do: hold every dashboard WebSocket connection and broadcast the same
JSON event to all of them. Deliberately tiny -- one manager, one
broadcast method -- since the only thing being pushed is transcript/call
status updates, never dispatch state (that still flows through the
existing SSE /dispatch/stream endpoint, untouched).
"""

from __future__ import annotations

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self._connections.discard(websocket)

    async def broadcast(self, event: dict) -> None:
        # Iterate a snapshot, not the live set -- a connect()/disconnect()
        # from another coroutine while this loop awaits send_json() would
        # otherwise raise "Set changed size during iteration".
        dead: list[WebSocket] = []
        for connection in list(self._connections):
            try:
                await connection.send_json(event)
            except Exception:
                dead.append(connection)
        for connection in dead:
            self.disconnect(connection)

    @property
    def connection_count(self) -> int:
        return len(self._connections)


manager = ConnectionManager()
