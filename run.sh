#!/bin/bash
# Launch the local call-copilot: whisper-server + Electron overlay (Ollama runs as a service already)
set -e
WHISPER_DIR="$HOME/VoiceInk-Dependencies/whisper.cpp"

# 1. whisper server (skip if already up)
if ! lsof -ti :8178 -sTCP:LISTEN >/dev/null 2>&1; then
    echo "starting whisper-server on :8178..."
    "$WHISPER_DIR/build/bin/whisper-server" -m "$WHISPER_DIR/models/ggml-small.en.bin" \
        --port 8178 --threads 4 >/tmp/whisper-server.log 2>&1 &
    sleep 3
fi

# 2. sanity: ollama up?
curl -sf http://127.0.0.1:11434/api/version >/dev/null || { echo "ERROR: Ollama not running"; exit 1; }

# 3. launch overlay (OLLAMA_MODEL=gemma3:4b ./run.sh for the lighter brain)
cd "$(dirname "$0")"
export OLLAMA_MODEL="${OLLAMA_MODEL:-qwen3:8b}"
echo "brain: $OLLAMA_MODEL | whisper: :8178 | starting overlay..."
npx electron-forge start
