"""ConnectionManager is the FastAPI-native stand-in for a Socket.io room
(see voice/socket.py) -- tested against a minimal fake WebSocket rather
than a real network connection, since the only real behavior worth
proving is "every connected client gets every broadcast event" and "a
send failure drops that client instead of blocking the others."
"""

from __future__ import annotations

import pytest

from app.voice.socket import ConnectionManager


class FakeWebSocket:
    def __init__(self, fail_on_send: bool = False):
        self.accepted = False
        self.received: list[dict] = []
        self._fail_on_send = fail_on_send

    async def accept(self):
        self.accepted = True

    async def send_json(self, event: dict):
        if self._fail_on_send:
            raise ConnectionError("client went away")
        self.received.append(event)


@pytest.mark.asyncio
async def test_connect_accepts_and_registers_the_socket():
    manager = ConnectionManager()
    ws = FakeWebSocket()
    await manager.connect(ws)
    assert ws.accepted
    assert manager.connection_count == 1


@pytest.mark.asyncio
async def test_broadcast_delivers_to_every_connected_client():
    manager = ConnectionManager()
    ws1, ws2 = FakeWebSocket(), FakeWebSocket()
    await manager.connect(ws1)
    await manager.connect(ws2)

    event = {"type": "transcript_update", "call_id": "c1", "text": "hello", "is_final": True}
    await manager.broadcast(event)

    assert ws1.received == [event]
    assert ws2.received == [event]


@pytest.mark.asyncio
async def test_disconnect_removes_the_socket_from_future_broadcasts():
    manager = ConnectionManager()
    ws = FakeWebSocket()
    await manager.connect(ws)
    manager.disconnect(ws)
    assert manager.connection_count == 0

    await manager.broadcast({"type": "call_status", "call_id": "c1", "status": "ended"})
    assert ws.received == []


@pytest.mark.asyncio
async def test_broadcast_drops_a_client_whose_send_fails_without_blocking_others():
    manager = ConnectionManager()
    dead = FakeWebSocket(fail_on_send=True)
    alive = FakeWebSocket()
    await manager.connect(dead)
    await manager.connect(alive)

    event = {"type": "call_status", "call_id": "c1", "status": "in_progress"}
    await manager.broadcast(event)

    assert alive.received == [event]
    assert manager.connection_count == 1
