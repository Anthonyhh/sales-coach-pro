# Call-Copilot — Forensic Handover & Rebuild Guide

Rebuild the 100% local live-call copilot on any Apple Silicon Mac. Written 2026-07-18 from the working build at `/Users/ant/Mac Voice Trascriber/call-copilot` on a 16GB M-series Mac.

## What this is

A transparent, always-on-top Electron overlay that listens to a live call (client via system audio, you via mic), transcribes locally with whisper.cpp, and streams live coaching from a local Ollama model: **ASK NEXT** (questions to ask now) + **GUIDANCE** (answers to client objections/questions). No audio or text ever leaves the machine. Hidden from screen-share (content protection).

**Audio path:** `SystemAudioDump` (bundled Mach-O binary, stereo 24kHz PCM → mono) + mic → `src/utils/localBrain.js` → whisper-server `:8178` → Ollama `:11434` → overlay via IPC.

## ⚠️ Source-of-truth warning

`github.com/Anthonyhh/sales-coach-pro` contains the ORIGINAL BROKEN code (a rebrand script corrupted 3 files) and none of the local-brain work. The working code lives only in this folder. Transport it one of two ways:

**Option A (preferred) — push from the original Mac:**
```bash
cd "/Users/ant/Mac Voice Trascriber/call-copilot"
git checkout -b local-brain
git add -A && git commit -m "feat: local brain (whisper.cpp + Ollama), repair rebrand corruption, run.sh"
git push -u origin local-brain
# on the new Mac:
git clone -b local-brain https://github.com/Anthonyhh/sales-coach-pro.git call-copilot
```

**Option B — tarball / AirDrop:**
```bash
cd "/Users/ant/Mac Voice Trascriber"
tar -czf call-copilot.tgz --exclude node_modules call-copilot
# AirDrop/copy call-copilot.tgz to the new Mac, then: tar -xzf call-copilot.tgz
```

If you ever must start from the broken GitHub main instead, the 3 corruption fixes are documented in Appendix A — but `src/utils/localBrain.js` and `run.sh` cannot be recreated that way; they must come from this build.

## Prerequisites (new Mac)

| Requirement | Check | Install |
|---|---|---|
| Apple Silicon, **16GB+ RAM** | `sysctl hw.memsize` | — (8GB will not run qwen3:8b + whisper) |
| Xcode CLT | `xcode-select -p` | `xcode-select --install` |
| Homebrew | `brew -v` | brew.sh |
| Node ≥ 20 | `node -v` | `brew install node` |
| cmake | `cmake --version` | `brew install cmake` |
| Ollama **≥ 0.31** | `ollama --version` | `brew install ollama` (older versions can't load newer model archs — 0.17 failed on gemma4) |

## Step 1 — Ollama service (permanent, tuned)

Do NOT use `brew services start ollama` — brew regenerates its plist on upgrade and you lose the env tuning, and a stale brew server holding port 11434 with wrong env was a real failure on the original Mac. Use a custom LaunchAgent:

`~/Library/LaunchAgents/com.<user>.ollama.plist` (adjust username in paths):
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key><string>com.user.ollama</string>
	<key>ProgramArguments</key>
	<array><string>/opt/homebrew/opt/ollama/bin/ollama</string><string>serve</string></array>
	<key>EnvironmentVariables</key>
	<dict>
		<key>OLLAMA_KEEP_ALIVE</key><string>5m</string>
		<key>OLLAMA_FLASH_ATTENTION</key><string>1</string>
	</dict>
	<key>RunAtLoad</key><true/>
	<key>KeepAlive</key><true/>
	<key>StandardOutPath</key><string>/Users/USER/.ollama/logs/server.log</string>
	<key>StandardErrorPath</key><string>/Users/USER/.ollama/logs/server.log</string>
</dict>
</plist>
```

```bash
mkdir -p ~/.ollama/logs
brew services stop ollama 2>/dev/null          # kill any brew-managed copy
pkill -f 'ollama serve'; sleep 2
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.<user>.ollama.plist
```

**Verify (forensic):**
```bash
PID=$(lsof -ti :11434 -sTCP:LISTEN); ps eww $PID | tr ' ' '\n' | grep KEEP_ALIVE
# MUST print OLLAMA_KEEP_ALIVE=5m — if it prints -1 or 24h, a stale server owns the port; pkill and re-bootstrap
```

Pull models (~8.5GB total download):
```bash
ollama pull qwen3:8b     # 5.2GB — the coach brain (tool-calling, think-toggle)
ollama pull gemma3:4b    # 3.3GB — lighter fallback brain
```

Speed sanity (warm, expect ≥ 8 tok/s on 16GB M-series):
```bash
curl -s http://127.0.0.1:11434/api/chat -d '{"model":"qwen3:8b","think":false,"stream":false,"messages":[{"role":"user","content":"say OK"}],"options":{"num_predict":5}}'
```
`"think": false` is load-bearing: qwen3 otherwise burns its whole token budget on hidden reasoning and answers slowly or not at all.

## Step 2 — whisper.cpp server

```bash
git clone https://github.com/ggml-org/whisper.cpp.git ~/whisper.cpp
cd ~/whisper.cpp
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build --target whisper-server -j 8        # ~2-3 min, Metal on by default
bash ./models/download-ggml-model.sh small.en            # 466MB (use "small" if calls won't be English)
```

**Verify:**
```bash
./build/bin/whisper-server -m models/ggml-small.en.bin --port 8178 --threads 4 &
sleep 5
python3 -c "
import struct, wave
w = wave.open('/tmp/s.wav','w'); w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000)
w.writeframes(struct.pack('<24000h', *([0]*24000))); w.close()"
curl -s http://127.0.0.1:8178/inference -F file=@/tmp/s.wav -F response_format=json
# expected: {"text":" [BLANK_AUDIO]\n"}  ← this IS success; localBrain strips bracket artifacts
```

If whisper.cpp lives anywhere other than `~/VoiceInk-Dependencies/whisper.cpp`, edit `WHISPER_DIR` at the top of `run.sh`.

## Step 3 — the app

```bash
cd call-copilot        # from Option A or B above
npm install
chmod +x src/assets/SystemAudioDump run.sh
node --check src/utils/localBrain.js && npx vitest run   # expect: syntax OK, 7/7 tests pass
./run.sh
```

`run.sh` starts whisper-server if it's down, health-checks Ollama, then launches the overlay. Brain override: `OLLAMA_MODEL=gemma3:4b ./run.sh`.

## Step 4 — macOS permissions (human-only, one-time)

On first session start macOS will prompt — these cannot be pre-granted from a script:
1. **Microphone** → Allow
2. **Screen/system-audio capture** (for SystemAudioDump) → Allow, may require app restart
3. If prompts never appear: System Settings → Privacy & Security → Microphone / Screen Recording → add the app (it appears under a disguised name — the boot log line `Set app name to:` tells you what to look for, e.g. "RemoteService"/"ChromeAgent").

## Step 5 — end-to-end test

1. `./run.sh` → overlay appears (dark glass panel)
2. Pick profile (sales-call / objection-handling / demo / discovery / closing / negotiation) + paste any deal context in the Customize box
3. Start session → status "Local session connected", then "Listening..."
4. Play any talking video through the speakers → within ~3-6s, coaching appears: **ASK NEXT** / **GUIDANCE**
5. Hotkeys: `Cmd+\` hide/show · `Cmd+M` click-through · `Alt+arrows` move · `Cmd+Enter` manual ask · `Cmd+Shift+E` emergency erase

## Architecture reference (what lives where)

| File | Role |
|---|---|
| `src/utils/localBrain.js` | The entire local pipeline. Replaces `gemini.js` 1:1 — exports the same symbols, keeps every IPC channel name (`initialize-gemini`, `send-audio-content`, `send-mic-audio-content`, `start-macos-audio`, …) so renderer/UI needed zero changes. Contains: SystemAudioDump spawn, RMS utterance segmentation (flush ≥3.0s, or ≥0.8s + 0.5s trailing silence, RMS<350 = silence), PCM→WAV, whisper POST, Ollama `/api/chat` streaming with `think:false`, coach debounce 1200ms. Config via env: `WHISPER_URL`, `OLLAMA_URL`, `OLLAMA_MODEL`. |
| `src/index.js` | One-word change from upstream: requires `./utils/localBrain` instead of `./utils/gemini`. |
| `src/utils/gemini.js` | Original Gemini pipeline — dead code now, kept for reference. |
| `src/utils/prompts.js` | Coaching profiles/prompt library (model-agnostic, reused as-is). |
| `src/assets/SystemAudioDump` | Mach-O binary that taps system audio → stereo 24kHz 16-bit PCM on stdout. The hardest-to-rebuild artifact — always transport it. |
| `run.sh` | Launcher: whisper up → Ollama check → electron-forge start. |

Screenshots (`send-image-content`) are accepted-and-dropped in local mode — that was a Gemini-vision feature.

## Troubleshooting (all hit for real during the original build)

| Symptom | Cause | Fix |
|---|---|---|
| Model load times out; log: `free_swap="0 B"` | Machine-wide memory exhaustion | Reboot. 16GB has no headroom for leaks + two models |
| Ollama replies but keep-alive wrong / model pinned Forever | Stale server owns :11434 (old brew service or `launchctl setenv` leftovers) | `launchctl unsetenv OLLAMA_KEEP_ALIVE; pkill -f 'ollama serve'` then re-bootstrap the agent; verify with the `ps eww` check |
| qwen3:8b "answers" empty / super slow | Thinking mode on | Ensure `think:false` (localBrain sets it) |
| Double RAM usage, everything swaps | A second app (e.g. Msty's bundled engine) loaded its own copy of the model | One inference runtime only: everything points at Ollama :11434 |
| Whisper returns `[BLANK_AUDIO]`, `(coughs)` | Normal on silence | Already stripped by localBrain's regex |
| SystemAudioDump exits instantly / tiny output when run from a shell | TCC permission is per-app | Test from inside the app, not bash; grant Screen Recording |
| Electron app invisible in `pgrep Electron` | Stealth heritage randomizes process/app name | Check boot log `Set process title to:` for the actual name |
| `timeout` command not found in scripts | macOS has no GNU timeout | Don't use it (run.sh doesn't) |

## Consent note

This listens to client calls. UK: one-party consent covers personal notes, but announce recording if transcripts/recordings are shared or stored beyond personal use. US: several states require all-party consent. The overlay being invisible on screen-share does not change the law.

## Phase 2 (designed, not built)

Knowledge base: embedded ChromaDB (in-process, no Docker) + `nomic-embed-text` via Ollama (274MB) + the document-chunking pattern from `Anthonyhh/odysseus` (`src/rag_vector.py`, `personal_docs.py`, 1000/200 chunks) → grounded **GUIDANCE** with citations from your own PDFs/docs. Odysseus also donates the LLM-endpoint and STT-service patterns if this ever grows into a full workspace.

---

## Appendix A — the 3 rebrand-corruption fixes (only needed if starting from broken GitHub main)

The upstream repo's `rebrand.sh` did a blind `stealth→focus-mode` sed, producing invalid JS:

1. `src/config.js:8` — `focus-modeLevel: "balanced"` → `stealthLevel: "balanced"`
2. `src/index.js` — `require('./utils/focus-modeFeatures')` → `require('./utils/stealthFeatures')`; every `focus-modeLevel` identifier → `stealthLevel` (5 sites; keep the IPC channel string `'set-focus-mode-level'` as-is)
3. `src/utils/window.js:5` — `require('./focus-modeFeatures')` → `require('./stealthFeatures')`
4. `src/utils/prompts.js:159` — `objection-handling: {` → `'objection-handling': {` (quote the hyphenated key)

Verify: `for f in $(find src -name '*.js'); do node --check "$f"; done` → silence = clean.
