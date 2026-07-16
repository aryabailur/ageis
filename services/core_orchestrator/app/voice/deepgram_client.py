"""Thin wrapper around Deepgram's live streaming transcription websocket
(wss://api.deepgram.com/v1/listen). Raw `websockets` client, no Deepgram
SDK dependency -- this is the one integration point that actually needs
DEEPGRAM_API_KEY to run; everything else in voice/ is exercisable without
it.

Deepgram protocol (see their live-audio API reference): binary frames in
carry raw audio, JSON text frames come back with
channel.alternatives[0].transcript plus two distinct "done" signals --
is_final (this chunk is finalized, ~every 3-5s) and speech_final (a
silence gap means the utterance actually ended). Both are surfaced to
the caller so the UI can distinguish "still speaking" from "done
talking" if it ever wants to.
"""

from __future__ import annotations

import json
import os
import ssl
from collections.abc import AsyncIterator
from dataclasses import dataclass

import certifi
import websockets

# Some Python installs (notably python.org's macOS installer) ship without
# wiring the interpreter up to the system CA trust store, so the default
# SSL context used by `websockets.connect` for a wss:// URL can fail with
# CERTIFICATE_VERIFY_FAILED even though the certificate itself is fine.
# Building the context from certifi's bundle explicitly makes this work
# the same way regardless of how Python was installed.
_SSL_CONTEXT = ssl.create_default_context(cafile=certifi.where())

DEEPGRAM_URL = (
    "wss://api.deepgram.com/v1/listen"
    "?encoding=mulaw&sample_rate=8000&channels=1&model=nova-2&interim_results=true"
)


@dataclass
class TranscriptEvent:
    text: str
    is_final: bool
    speech_final: bool


class DeepgramStreamingClient:
    """One instance per phone call. Caller feeds raw mu-law audio bytes
    via send_audio(); transcript events arrive through receive_events()
    running concurrently. Closing calls Deepgram's documented CloseStream
    handshake so buffered audio gets a final transcript before the
    socket actually closes."""

    def __init__(self, api_key: str | None = None):
        self._api_key = api_key or os.environ.get("DEEPGRAM_API_KEY")
        if not self._api_key:
            raise RuntimeError("DEEPGRAM_API_KEY is not set -- required to start a Deepgram streaming session")
        self._ws: websockets.WebSocketClientProtocol | None = None

    async def connect(self) -> None:
        self._ws = await websockets.connect(
            DEEPGRAM_URL,
            additional_headers={"Authorization": f"Token {self._api_key}"},
            ssl=_SSL_CONTEXT,
        )

    async def send_audio(self, chunk: bytes) -> None:
        if self._ws is None:
            raise RuntimeError("DeepgramStreamingClient.connect() must be awaited before sending audio")
        await self._ws.send(chunk)

    async def receive_events(self) -> AsyncIterator[TranscriptEvent]:
        if self._ws is None:
            raise RuntimeError("DeepgramStreamingClient.connect() must be awaited before receiving events")
        async for raw in self._ws:
            payload = json.loads(raw)
            if payload.get("type") != "Results":
                continue
            alternatives = payload.get("channel", {}).get("alternatives", [])
            transcript = alternatives[0]["transcript"] if alternatives else ""
            if not transcript:
                continue
            yield TranscriptEvent(
                text=transcript,
                is_final=bool(payload.get("is_final")),
                speech_final=bool(payload.get("speech_final")),
            )

    async def close(self) -> None:
        if self._ws is None:
            return
        try:
            await self._ws.send(json.dumps({"type": "CloseStream"}))
        except Exception:
            pass
        await self._ws.close()
