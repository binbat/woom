# Reference streaming-STT server (sherpa-onnx). python:3.13-slim on purpose:
# sherpa-onnx only ships manylinux wheels, there are no musl/Alpine wheels.
FROM python:3.13-slim

ARG MODEL_URL=https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20.tar.bz2
ARG MODEL_DIR=sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20

WORKDIR /app

COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

RUN apt-get update \
    && apt-get install -y --no-install-recommends curl bzip2 \
    && curl -fsSL "$MODEL_URL" -o /tmp/model.tar.bz2 \
    && tar -xjf /tmp/model.tar.bz2 -C /opt \
    && rm /tmp/model.tar.bz2 \
    # only the int8 runtime files are used; drop fp32 duplicates and test wavs
    && find "/opt/${MODEL_DIR}" -name '*.onnx' ! -name '*.int8.onnx' -delete \
    && rm -rf "/opt/${MODEL_DIR}/test_wavs" \
    && apt-get purge -y curl bzip2 \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

COPY sherpa_ws_server.py .

ENV SHERPA_MODEL_DIR=/opt/${MODEL_DIR} \
    STT_WS_HOST=0.0.0.0 \
    STT_WS_PORT=6006

EXPOSE 6006

CMD ["python", "sherpa_ws_server.py"]
