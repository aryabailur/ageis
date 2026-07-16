"""Handles Twilio's Media Streams websocket protocol: a stream of JSON
text frames with an "event" field -- "connected" once, "start" once
(carries call metadata), repeated "media" frames (base64-encoded 8kHz
mono mu-law audio in media.payload), and "stop" when the call/stream
ends. See https://www.twilio.com/docs/voice/media-streams/websocket-messages.

Each inbound call gets its own DeepgramStreamingClient; audio bytes are
forwarded to Deepgram as they arrive, and Deepgram's transcript events
are relayed to the dashboard via voice.socket's broadcaster -- this
module never touches triage/ranking/dispatch, it only ever produces
transcript text for a human to review and explicitly submit.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging

from fastapi import WebSocket, WebSocketDisconnect

from . import session
from .deepgram_client import DeepgramStreamingClient
from .socket import manager

logger = logging.getLogger("aegis.voice.twilio_stream")


async def handle_twilio_media_stream(websocket: WebSocket) -> None:
    await websocket.accept()
    call_id: str | None = None
    deepgram: DeepgramStreamingClient | None = None
    relay_task: asyncio.Task | None = None
    media_frames_received = 0

    try:
        while True:
            raw = await websocket.receive_text()
            message = json.loads(raw)
            event = message.get("event")
            logger.info("twilio_stream event=%s call_id=%s", event, call_id)

            if event == "connected":
                continue

            if event == "start":
                start_info = message["start"]
                call_id = start_info["callSid"]
                caller_number = start_info.get("customParameters", {}).get("from") or start_info.get("from")
                session.start(call_id, source="twilio", caller_number=caller_number)
                await manager.broadcast(
                    {
                        "type": "call_status",
                        "call_id": call_id,
                        "status": "in_progress",
                        "caller_number": caller_number,
                        "source": "twilio",
                    }
                )
                try:
                    deepgram = DeepgramStreamingClient()
                    await deepgram.connect()
                except Exception:
                    logger.exception("Deepgram connect failed for call %s", call_id)
                    raise
                relay_task = asyncio.create_task(_relay_transcripts(call_id, deepgram))
                logger.info("twilio_stream deepgram connected call_id=%s", call_id)
                continue

            if event == "media" and deepgram is not None:
                payload_b64 = message["media"]["payload"]
                audio_bytes = base64.b64decode(payload_b64)
                await deepgram.send_audio(audio_bytes)
                media_frames_received += 1
                continue

            if event == "stop":
                break

    except WebSocketDisconnect as exc:
        logger.warning(
            "twilio_stream disconnected early call_id=%s code=%s reason=%s media_frames_received=%d",
            call_id, exc.code, exc.reason, media_frames_received,
        )
    finally:
        if deepgram is not None:
            await deepgram.close()
        if relay_task is not None:
            relay_task.cancel()
        if call_id is not None:
            ended = session.end(call_id)
            await manager.broadcast(
                {
                    "type": "call_status",
                    "call_id": call_id,
                    "status": "ended",
                    "duration_s": ended.duration_s if ended else None,
                    "source": "twilio",
                }
            )
        else:
            logger.warning("twilio_stream ended before 'start' event ever arrived (media_frames_received=%d)", media_frames_received)


async def _relay_transcripts(call_id: str, deepgram: DeepgramStreamingClient) -> None:
    try:
        async for event in deepgram.receive_events():
            session.append_transcript(call_id, event.text, is_final=event.is_final)
            await manager.broadcast(
                {
                    "type": "transcript_update",
                    "call_id": call_id,
                    "text": event.text,
                    "is_final": event.is_final,
                    "source": "twilio",
                }
            )
    except Exception:
        logger.exception("Deepgram relay for call %s stopped unexpectedly", call_id)
