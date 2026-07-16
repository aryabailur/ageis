"""Dev/test-only page: lets a real phone (or any browser) simulate an
inbound Twilio call by capturing its own microphone and streaming it to
/voice/twilio/stream using Twilio's exact wire protocol (connected/start/
media/stop JSON frames, base64 8kHz mono mu-law audio) -- exercising the
REAL Twilio code path (twilio_stream.py, deepgram_client.py) without
needing a Twilio phone number or a PSTN call.

Not linked from the dashboard; reached directly via
<PUBLIC_TUNNEL_URL>/voice/phone-simulator so a phone can load it over
HTTPS (getUserMedia requires a secure context off localhost).
"""

from __future__ import annotations

PHONE_SIMULATOR_HTML = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AEGIS — phone call simulator (dev/test only)</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #0a0e17; color: #eef1f8; margin: 0; padding: 24px 20px; }
  h1 { font-size: 18px; margin: 0 0 6px; }
  p.sub { color: #8992a9; font-size: 13px; margin: 0 0 24px; }
  button { width: 100%; padding: 16px; font-size: 16px; font-weight: 700; border-radius: 10px; border: none; margin-bottom: 12px; }
  #startBtn { background: #34d399; color: #04140d; }
  #stopBtn { background: #f0576b; color: #200608; }
  #stopBtn:disabled, #startBtn:disabled { opacity: 0.4; }
  #status { padding: 12px; background: #141a26; border: 1px solid #232b3d; border-radius: 8px; font-size: 13px; line-height: 1.6; white-space: pre-wrap; }
  .transcript { margin-top: 12px; padding: 12px; background: #141a26; border: 1px solid #232b3d; border-radius: 8px; min-height: 60px; }
</style>
</head>
<body>
  <h1>AEGIS phone call simulator</h1>
  <p class="sub">Dev/test tool: streams THIS device's mic to the same Twilio media-stream endpoint a real
  phone call would hit — for testing without a Twilio phone number.</p>
  <button id="startBtn">Start simulated call</button>
  <button id="stopBtn" disabled>End call</button>
  <div id="status">Idle.</div>
  <div class="transcript" id="transcript"></div>

<script>
const statusEl = document.getElementById('status');
const transcriptEl = document.getElementById('transcript');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');

function log(msg) {
  statusEl.textContent += '\\n' + msg;
  statusEl.scrollTop = statusEl.scrollHeight;
}

// G.711 mu-law encoder -- standard reference algorithm (BIAS=0x84,
// CLIP=32635), same encoding Twilio's own Media Streams audio uses.
function linearToMulaw(sample) {
  const BIAS = 0x84, CLIP = 32635;
  let sign = (sample >> 8) & 0x80;
  if (sign !== 0) sample = -sample;
  if (sample > CLIP) sample = CLIP;
  sample += BIAS;
  let exponent = 7;
  for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1) {}
  const mantissa = (sample >> (exponent + 3)) & 0x0f;
  const mulawByte = ~(sign | (exponent << 4) | mantissa) & 0xff;
  return mulawByte;
}

let ws = null;
let audioCtx = null;
let processor = null;
let source = null;
let stream = null;
let callId = 'sim-' + Date.now().toString(36);

// Twilio sends 8kHz mono. getUserMedia mic capture runs at the
// AudioContext's native rate (usually 44.1/48kHz), so each captured
// buffer is downsampled by simple decimation before mu-law encoding --
// good enough for speech intelligibility at this sample rate, matching
// what a real phone call's telephony codec would produce anyway.
function downsampleTo8k(input, inputRate) {
  const ratio = inputRate / 8000;
  const outLength = Math.floor(input.length / ratio);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i++) {
    const sample = input[Math.floor(i * ratio)];
    out[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32768)));
  }
  return out;
}

async function startCall() {
  startBtn.disabled = true;
  statusEl.textContent = 'Requesting microphone…';
  transcriptEl.textContent = '';

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    log('Mic error: ' + err.message);
    startBtn.disabled = false;
    return;
  }

  const wsUrl = location.origin.replace(/^http/, 'ws') + '/voice/twilio/stream';
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    log('Connected to ' + wsUrl);
    ws.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }));
    ws.send(JSON.stringify({
      event: 'start',
      start: {
        callSid: callId,
        streamSid: 'MZ' + callId,
        accountSid: 'phone-simulator',
        from: 'phone-simulator',
        to: 'phone-simulator',
        mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
      },
    }));
    log('Call started: ' + callId);
    stopBtn.disabled = false;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    source = audioCtx.createMediaStreamSource(stream);
    processor = audioCtx.createScriptProcessor(2048, 1, 1);
    source.connect(processor);
    processor.connect(audioCtx.destination);

    processor.onaudioprocess = (e) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      const input = e.inputBuffer.getChannelData(0);
      const pcm8k = downsampleTo8k(input, audioCtx.sampleRate);
      const mulawBytes = new Uint8Array(pcm8k.length);
      for (let i = 0; i < pcm8k.length; i++) mulawBytes[i] = linearToMulaw(pcm8k[i]);
      const payload = btoa(String.fromCharCode(...mulawBytes));
      ws.send(JSON.stringify({ event: 'media', media: { payload } }));
    };
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'transcript_update') {
      transcriptEl.textContent = (transcriptEl.textContent + ' ' + data.text).trim();
    }
    log('event: ' + event.data.slice(0, 120));
  };

  ws.onerror = () => log('WebSocket error');
  ws.onclose = () => log('WebSocket closed');
}

function endCall() {
  stopBtn.disabled = true;
  startBtn.disabled = false;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ event: 'stop' }));
    setTimeout(() => ws.close(), 500);
  }
  if (processor) { processor.disconnect(); processor = null; }
  if (source) { source.disconnect(); source = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  log('Call ended.');
  callId = 'sim-' + Date.now().toString(36);
}

startBtn.addEventListener('click', startCall);
stopBtn.addEventListener('click', endCall);
</script>
</body>
</html>
"""
