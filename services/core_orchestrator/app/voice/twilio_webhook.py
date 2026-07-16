"""Incoming-call TwiML webhook. Twilio hits this HTTP endpoint the
moment someone calls the configured phone number; the response tells
Twilio where to open the Media Streams websocket. Uses the `twilio`
package's TwiML builders only for XML generation -- the actual media
stream is parsed by hand in twilio_stream.py, per Twilio's own docs
(there's no SDK helper for consuming the stream, only for producing the
TwiML that requests one).
"""

from __future__ import annotations

import os

from twilio.twiml.voice_response import Connect, VoiceResponse


def _public_stream_url() -> str:
    tunnel_base = os.environ.get("PUBLIC_TUNNEL_URL", "").rstrip("/")
    if not tunnel_base:
        raise RuntimeError(
            "PUBLIC_TUNNEL_URL is not set -- start ngrok (or another public https/wss tunnel) "
            "pointed at this service and set PUBLIC_TUNNEL_URL to its wss:// origin, "
            "e.g. wss://abcd1234.ngrok.io"
        )
    # Accept either an http(s):// or ws(s):// base and normalize to wss://.
    origin = tunnel_base.split("://", 1)[-1]
    return f"wss://{origin}/voice/twilio/stream"


def incoming_call_twiml() -> str:
    response = VoiceResponse()
    connect = Connect()
    connect.stream(url=_public_stream_url())
    response.append(connect)
    return str(response)
