#!/usr/bin/env python3
"""Reference streaming-STT server for woom-caption, using sherpa-onnx.

Implements the woom-caption STT WebSocket protocol, one connection per
speaker:

  client -> server (text):
      {"type":"start","sampleRate":16000,"channels":1,"format":"s16le","language":"auto"}
      {"type":"stop"}
  client -> server (binary): PCM s16le, 16 kHz, mono (~100 ms frames)
  server -> client (text):
      {"type":"ready"}
      {"type":"partial","text":"..."}
      {"type":"final","text":"..."}
      {"type":"error","message":"..."}

Endpoint detection (trailing silence) turns a partial into a final and resets
the recognizer, so one connection yields a stream of utterances.

CPU only. The model engine is auto-detected from the model directory:

  - encoder + decoder + joiner ONNX files -> transducer, e.g. the bilingual
    (zh/en) streaming Zipformer (default):
    sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20
  - encoder + decoder ONNX files, no joiner -> streaming Paraformer, e.g.
    sherpa-onnx-streaming-paraformer-bilingual-zh-en

Both take a tokens.txt alongside the ONNX files; int8 files are preferred.
(Offline paraformer packages with a single model.onnx are not streaming
models and are rejected with a clear error.)

Configuration via environment:

  STT_WS_HOST        listen address          (default 127.0.0.1)
  STT_WS_PORT        listen port             (default 6006)
  SHERPA_MODEL_DIR   model directory         (default ./sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20)
  SHERPA_ENCODER / SHERPA_DECODER / SHERPA_JOINER
                     explicit transducer component paths; set all three to use
                     a transducer model outside the directory scan, or set one
                     to override that component within a transducer directory
  SHERPA_TOKENS      explicit tokens.txt path, overriding the directory scan
  SHERPA_NUM_THREADS decode threads          (default 2)
  SHERPA_INT8        "0" to prefer the fp32 model files (default: prefer int8)
"""

import asyncio
import glob
import json
import os
import sys

import numpy as np
import sherpa_onnx
from websockets.asyncio.server import serve

HOST = os.environ.get("STT_WS_HOST", "127.0.0.1")
PORT = int(os.environ.get("STT_WS_PORT", "6006"))
DEFAULT_MODEL_DIR = "./sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20"

# Endpoint rules: seconds of trailing silence before an utterance is committed
# as a final transcript. Tuned snappier than the sherpa-onnx defaults because
# these transcripts are live captions.
RULE1_MIN_TRAILING_SILENCE = 1.2  # utterance ended after a decoded sentence
RULE2_MIN_TRAILING_SILENCE = 0.6  # mid-utterance pause
RULE3_MIN_UTTERANCE_LENGTH = 20.0  # force-commit very long utterances


def _fatal(message):
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def _find_model_file(model_dir, pattern):
    """Pick one ONNX file in `model_dir` matching `pattern` (a glob), preferring
    int8 unless SHERPA_INT8=0. Returns None when nothing matches."""
    candidates = sorted(glob.glob(os.path.join(model_dir, pattern)))
    if not candidates:
        return None
    prefer_int8 = os.environ.get("SHERPA_INT8", "1") != "0"
    int8 = [c for c in candidates if ".int8." in c]
    fp32 = [c for c in candidates if ".int8." not in c]
    if prefer_int8 and int8:
        return int8[0]
    if not prefer_int8 and fp32:
        return fp32[0]
    return candidates[0]


def _load(engine, factory, kwargs):
    files = [f"  {name}: {kwargs[name]}" for name in ("encoder", "decoder", "joiner") if name in kwargs]
    files.append(f"  tokens:  {kwargs['tokens']}")
    print(f"Loading {engine} model:\n" + "\n".join(files), file=sys.stderr)
    return factory(**kwargs)


def create_recognizer():
    model_dir = os.environ.get("SHERPA_MODEL_DIR", DEFAULT_MODEL_DIR)
    tokens = os.environ.get("SHERPA_TOKENS") or os.path.join(model_dir, "tokens.txt")
    if not os.path.isfile(tokens):
        _fatal(f"tokens file not found: {tokens} (set SHERPA_TOKENS to override)")
    num_threads = int(os.environ.get("SHERPA_NUM_THREADS", "2"))

    common = dict(
        tokens=tokens,
        num_threads=num_threads,
        sample_rate=16000,
        feature_dim=80,
        enable_endpoint_detection=True,
        rule1_min_trailing_silence=RULE1_MIN_TRAILING_SILENCE,
        rule2_min_trailing_silence=RULE2_MIN_TRAILING_SILENCE,
        rule3_min_utterance_length=RULE3_MIN_UTTERANCE_LENGTH,
        decoding_method="greedy_search",
    )

    encoder = os.environ.get("SHERPA_ENCODER")
    decoder = os.environ.get("SHERPA_DECODER")
    joiner = os.environ.get("SHERPA_JOINER")

    if encoder or decoder or joiner:
        # Explicit transducer component paths. Overrides apply individually on
        # top of the directory scan when it is transducer-shaped.
        scanned_encoder = _find_model_file(model_dir, "encoder*.onnx")
        scanned_decoder = _find_model_file(model_dir, "decoder*.onnx")
        scanned_joiner = _find_model_file(model_dir, "joiner*.onnx")
        encoder = encoder or scanned_encoder
        decoder = decoder or scanned_decoder
        joiner = joiner or scanned_joiner
        if not (encoder and decoder and joiner):
            _fatal(
                "SHERPA_ENCODER, SHERPA_DECODER and SHERPA_JOINER must be set "
                f"together for a transducer model (checked {model_dir})"
            )
        return _load(
            "transducer",
            sherpa_onnx.OnlineRecognizer.from_transducer,
            dict(encoder=encoder, decoder=decoder, joiner=joiner, **common),
        )

    joiner = _find_model_file(model_dir, "joiner*.onnx")
    if joiner:
        encoder = _find_model_file(model_dir, "encoder*.onnx")
        decoder = _find_model_file(model_dir, "decoder*.onnx")
        if not (encoder and decoder):
            _fatal(f"incomplete transducer model in {model_dir!r}: joiner present but encoder/decoder missing")
        return _load(
            "transducer",
            sherpa_onnx.OnlineRecognizer.from_transducer,
            dict(encoder=encoder, decoder=decoder, joiner=joiner, **common),
        )

    encoder = _find_model_file(model_dir, "encoder*.onnx")
    decoder = _find_model_file(model_dir, "decoder*.onnx")
    if encoder and decoder:
        return _load(
            "paraformer",
            sherpa_onnx.OnlineRecognizer.from_paraformer,
            dict(encoder=encoder, decoder=decoder, **common),
        )

    _fatal(
        f"cannot detect model engine in {model_dir!r}: expected either "
        "encoder+decoder+joiner ONNX files (transducer, e.g. streaming Zipformer) "
        "or encoder+decoder ONNX files (streaming Paraformer), plus tokens.txt. "
        "Offline packages with a single model.onnx are not streaming models."
    )


def _result_text(result):
    # sherpa-onnx returns a plain string in recent releases, an object with a
    # .text attribute in older ones.
    return result if isinstance(result, str) else result.text


async def handle(websocket, recognizer):
    peer = websocket.remote_address
    print(f"client connected: {peer}", file=sys.stderr)
    stream = None
    last_partial = ""
    try:
        async for message in websocket:
            if isinstance(message, (bytes, bytearray)):
                if stream is None:
                    continue  # audio before "start": ignore
                samples = np.frombuffer(message, dtype=np.int16).astype(np.float32) / 32768.0
                stream.accept_waveform(16000, samples)
                while recognizer.is_ready(stream):
                    recognizer.decode_stream(stream)
                text = _result_text(recognizer.get_result(stream))
                if recognizer.is_endpoint(stream):
                    if text:
                        await websocket.send(json.dumps({"type": "final", "text": text}))
                    recognizer.reset(stream)
                    last_partial = ""
                elif text and text != last_partial:
                    last_partial = text
                    await websocket.send(json.dumps({"type": "partial", "text": text}))
                continue

            try:
                msg = json.loads(message)
            except json.JSONDecodeError:
                await websocket.send(json.dumps({"type": "error", "message": "invalid JSON"}))
                continue
            msg_type = msg.get("type")
            if msg_type == "start":
                if (
                    msg.get("sampleRate") != 16000
                    or msg.get("channels") != 1
                    or msg.get("format") != "s16le"
                ):
                    await websocket.send(json.dumps({
                        "type": "error",
                        "message": "unsupported audio format; need s16le 16 kHz mono",
                    }))
                    continue
                stream = recognizer.create_stream()
                last_partial = ""
                await websocket.send(json.dumps({"type": "ready"}))
            elif msg_type == "stop":
                if stream is not None:
                    text = _result_text(recognizer.get_result(stream))
                    if text:
                        await websocket.send(json.dumps({"type": "final", "text": text}))
                    recognizer.reset(stream)
                    stream = None
                    last_partial = ""
            else:
                await websocket.send(json.dumps({
                    "type": "error",
                    "message": f"unknown message type: {msg_type!r}",
                }))
    finally:
        print(f"client disconnected: {peer}", file=sys.stderr)


async def main():
    recognizer = create_recognizer()
    async with serve(lambda ws: handle(ws, recognizer), HOST, PORT):
        print(f"STT websocket server listening on ws://{HOST}:{PORT}", file=sys.stderr)
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    asyncio.run(main())
