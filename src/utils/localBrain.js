// localBrain.js — 100% local replacement for gemini.js
// Pipeline: SystemAudioDump (client audio) + mic PCM → whisper-server (localhost) → Ollama → overlay
// Exposes the exact same IPC channels as gemini.js, so renderer/UI code is untouched.

const { BrowserWindow, ipcMain } = require('electron');
const { spawn, execSync } = require('child_process');
const { getSystemPrompt } = require('./prompts');

const WHISPER_URL = process.env.WHISPER_URL || 'http://127.0.0.1:8178/inference';
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:8b';

const SAMPLE_RATE = 24000;
const BYTES_PER_SAMPLE = 2;
// flush a speaker's buffer to whisper when it holds >= MAX_UTTER seconds,
// or >= MIN_UTTER seconds ending in TRAIL_SILENCE seconds of quiet
const MAX_UTTER_S = 3.0;
const MIN_UTTER_S = 0.8;
const TRAIL_SILENCE_S = 0.5;
const RMS_SILENCE = 350; // int16 RMS below this ≈ silence
const COACH_DEBOUNCE_MS = 1200;
const TRANSCRIPT_WINDOW = 24; // lines of context sent to the model

const COACH_INSTRUCTIONS = `
You are listening to a LIVE call. Based on the transcript, respond with exactly this structure:

**ASK NEXT:** one or two sharp discovery/qualifying questions the user should ask now, informed by what the client just said.

**GUIDANCE:** only if the client asked something or raised an objection — a 1-2 sentence suggested answer or handling line. Omit this section if nothing needs answering.

Be terse. No preamble, no repetition of the transcript.`;

let systemAudioProc = null;
let currentSessionId = null;

const state = {
    active: false,
    systemPrompt: '',
    transcript: [], // { speaker: 'Client' | 'You', text }
    buffers: { Client: Buffer.alloc(0), You: Buffer.alloc(0) },
    coachTimer: null,
    coachBusy: false,
    coachPending: false,
    history: [], // { transcription, ai_response }
};

function sendToRenderer(channel, data) {
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0) {
        windows[0].webContents.send(channel, data);
    }
}

function initializeNewSession() {
    currentSessionId = Date.now().toString();
    state.transcript = [];
    state.history = [];
    state.buffers = { Client: Buffer.alloc(0), You: Buffer.alloc(0) };
}

function getCurrentSessionData() {
    return {
        sessionId: currentSessionId,
        history: state.history,
    };
}

// ---------- audio: capture ----------

function killExistingSystemAudioDump() {
    try {
        execSync('pkill -f SystemAudioDump', { stdio: 'ignore' });
    } catch (e) {
        // no existing process — fine
    }
}

function startMacOSAudioCapture() {
    if (process.platform !== 'darwin') return false;
    killExistingSystemAudioDump();

    const { app } = require('electron');
    const path = require('path');

    const systemAudioPath = app.isPackaged
        ? path.join(process.resourcesPath, 'SystemAudioDump')
        : path.join(__dirname, '../assets', 'SystemAudioDump');

    systemAudioProc = spawn(systemAudioPath, [], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
    });

    if (!systemAudioProc.pid) {
        console.error('Failed to start SystemAudioDump');
        return false;
    }
    console.log('SystemAudioDump started, PID:', systemAudioProc.pid);

    const CHANNELS = 2;
    const CHUNK_SIZE = SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS * 0.1;
    let audioBuffer = Buffer.alloc(0);

    systemAudioProc.stdout.on('data', data => {
        audioBuffer = Buffer.concat([audioBuffer, data]);
        while (audioBuffer.length >= CHUNK_SIZE) {
            const chunk = audioBuffer.slice(0, CHUNK_SIZE);
            audioBuffer = audioBuffer.slice(CHUNK_SIZE);
            feedPcm('Client', convertStereoToMono(chunk));
        }
    });

    systemAudioProc.stderr.on('data', d => console.error('SystemAudioDump stderr:', d.toString()));
    systemAudioProc.on('close', code => {
        console.log('SystemAudioDump closed:', code);
        systemAudioProc = null;
    });
    systemAudioProc.on('error', err => {
        console.error('SystemAudioDump error:', err);
        systemAudioProc = null;
    });

    return true;
}

function convertStereoToMono(stereoBuffer) {
    const samples = stereoBuffer.length / 4;
    const monoBuffer = Buffer.alloc(samples * 2);
    for (let i = 0; i < samples; i++) {
        monoBuffer.writeInt16LE(stereoBuffer.readInt16LE(i * 4), i * 2);
    }
    return monoBuffer;
}

function stopMacOSAudioCapture() {
    if (systemAudioProc) {
        systemAudioProc.kill('SIGTERM');
        systemAudioProc = null;
    }
}

// ---------- audio: segmentation ----------

function rms(buf) {
    if (buf.length < 2) return 0;
    let sum = 0;
    const n = Math.floor(buf.length / 2);
    for (let i = 0; i < n; i++) {
        const s = buf.readInt16LE(i * 2);
        sum += s * s;
    }
    return Math.sqrt(sum / n);
}

function feedPcm(speaker, monoChunk) {
    if (!state.active) return;
    state.buffers[speaker] = Buffer.concat([state.buffers[speaker], monoChunk]);

    const buf = state.buffers[speaker];
    const secs = buf.length / (SAMPLE_RATE * BYTES_PER_SAMPLE);
    const trailBytes = Math.floor(TRAIL_SILENCE_S * SAMPLE_RATE) * BYTES_PER_SAMPLE;
    const trailingQuiet = buf.length > trailBytes && rms(buf.slice(buf.length - trailBytes)) < RMS_SILENCE;

    if (secs >= MAX_UTTER_S || (secs >= MIN_UTTER_S && trailingQuiet)) {
        state.buffers[speaker] = Buffer.alloc(0);
        if (rms(buf) >= RMS_SILENCE) {
            transcribe(speaker, buf).catch(err => console.error('transcribe error:', err.message));
        }
    }
}

// ---------- whisper ----------

function pcmToWav(pcmBuf) {
    const header = Buffer.alloc(44);
    const dataSize = pcmBuf.length;
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // PCM chunk size
    header.writeUInt16LE(1, 20); // PCM format
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
    header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
    header.writeUInt16LE(16, 34); // bits per sample
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    return Buffer.concat([header, pcmBuf]);
}

async function transcribe(speaker, pcmBuf) {
    const wav = pcmToWav(pcmBuf);
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'chunk.wav');
    form.append('response_format', 'json');

    const res = await fetch(WHISPER_URL, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`whisper ${res.status}`);
    const { text } = await res.json();

    const clean = (text || '')
        .replace(/\[[^\]]*\]|\([^)]*\)/g, '') // [BLANK_AUDIO], (coughs) etc.
        .replace(/\s+/g, ' ')
        .trim();
    if (!clean) return;

    state.transcript.push({ speaker, text: clean });
    sendToRenderer('update-status', 'Listening...');
    scheduleCoach();
}

// ---------- ollama coach ----------

function scheduleCoach() {
    clearTimeout(state.coachTimer);
    state.coachTimer = setTimeout(() => runCoach().catch(err => {
        console.error('coach error:', err.message);
        sendToRenderer('update-status', 'Error: ' + err.message);
    }), COACH_DEBOUNCE_MS);
}

async function runCoach() {
    if (!state.active || state.transcript.length === 0) return;
    if (state.coachBusy) {
        state.coachPending = true;
        return;
    }
    state.coachBusy = true;

    const lines = state.transcript
        .slice(-TRANSCRIPT_WINDOW)
        .map(t => `${t.speaker}: ${t.text}`)
        .join('\n');

    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: OLLAMA_MODEL,
            think: false,
            stream: true,
            messages: [
                { role: 'system', content: state.systemPrompt + '\n' + COACH_INSTRUCTIONS },
                { role: 'user', content: `LIVE TRANSCRIPT:\n${lines}` },
            ],
            options: { temperature: 0.4, num_predict: 220 },
        }),
    });
    if (!res.ok) throw new Error(`ollama ${res.status}`);

    let messageBuffer = '';
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let leftover = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunkText = leftover + decoder.decode(value, { stream: true });
        const jsonLines = chunkText.split('\n');
        leftover = jsonLines.pop();
        for (const line of jsonLines) {
            if (!line.trim()) continue;
            try {
                const msg = JSON.parse(line);
                if (msg.message && msg.message.content) {
                    messageBuffer += msg.message.content;
                    sendToRenderer('update-response', messageBuffer);
                }
            } catch (e) {
                // partial line — ignored
            }
        }
    }

    if (messageBuffer) {
        const lastClient = [...state.transcript].reverse().find(t => t.speaker === 'Client');
        const turn = {
            timestamp: Date.now(),
            transcription: lastClient ? lastClient.text : '',
            ai_response: messageBuffer,
        };
        state.history.push(turn);
        sendToRenderer('save-conversation-turn', {
            sessionId: currentSessionId,
            turn,
            fullData: getCurrentSessionData(),
        });
    }
    sendToRenderer('update-status', 'Listening...');

    state.coachBusy = false;
    if (state.coachPending) {
        state.coachPending = false;
        scheduleCoach();
    }
}

// ---------- health ----------

async function checkBackends() {
    try {
        await fetch(`${OLLAMA_URL}/api/version`);
    } catch (e) {
        throw new Error(`Ollama not reachable at ${OLLAMA_URL} — is the service running?`);
    }
    try {
        // whisper-server has no health route; an empty POST that returns any HTTP status proves it's up
        await fetch(WHISPER_URL, { method: 'POST' });
    } catch (e) {
        throw new Error(`Whisper server not reachable at ${WHISPER_URL} — start it first.`);
    }
}

// ---------- IPC (channel names preserved from gemini.js) ----------

function setupGeminiIpcHandlers(sessionRef) {
    global.geminiSessionRef = sessionRef;

    ipcMain.handle('initialize-gemini', async (event, apiKey, customPrompt = '', profile = 'sales-call', language = 'en-US') => {
        try {
            sendToRenderer('session-initializing', true);
            await checkBackends();
            state.systemPrompt = getSystemPrompt(profile, customPrompt, false);
            initializeNewSession();
            state.active = true;
            sessionRef.current = { local: true }; // truthy = renderer treats session as live
            sendToRenderer('session-initializing', false);
            sendToRenderer('update-status', 'Local session connected');
            return true;
        } catch (error) {
            console.error('init error:', error);
            sendToRenderer('session-initializing', false);
            sendToRenderer('update-status', 'Error: ' + error.message);
            return false;
        }
    });

    ipcMain.handle('send-audio-content', async (event, { data }) => {
        // non-macOS system audio path (base64 mono pcm from renderer)
        try {
            feedPcm('Client', Buffer.from(data, 'base64'));
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-mic-audio-content', async (event, { data }) => {
        try {
            feedPcm('You', Buffer.from(data, 'base64'));
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('send-image-content', async () => {
        // screenshots were a Gemini feature; dropped in local mode
        return { success: true };
    });

    ipcMain.handle('send-text-message', async (event, text) => {
        try {
            if (!text || !text.trim()) return { success: false, error: 'empty' };
            state.transcript.push({ speaker: 'You', text: text.trim() });
            clearTimeout(state.coachTimer);
            runCoach().catch(err => sendToRenderer('update-status', 'Error: ' + err.message));
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('start-macos-audio', async () => {
        if (process.platform !== 'darwin') {
            return { success: false, error: 'macOS only' };
        }
        const ok = startMacOSAudioCapture();
        return { success: ok, error: ok ? undefined : 'Failed to start SystemAudioDump' };
    });

    ipcMain.handle('stop-macos-audio', async () => {
        stopMacOSAudioCapture();
        return { success: true };
    });

    ipcMain.handle('close-session', async () => {
        stopMacOSAudioCapture();
        clearTimeout(state.coachTimer);
        state.active = false;
        sessionRef.current = null;
        sendToRenderer('update-status', 'Session closed');
        return { success: true };
    });

    ipcMain.handle('get-current-session', async () => {
        return { success: true, data: getCurrentSessionData() };
    });

    ipcMain.handle('start-new-session', async () => {
        initializeNewSession();
        return { success: true, sessionId: currentSessionId };
    });

    ipcMain.handle('update-google-search-setting', async () => {
        return { success: true }; // no-op in local mode
    });
}

module.exports = {
    sendToRenderer,
    initializeNewSession,
    getCurrentSessionData,
    killExistingSystemAudioDump,
    startMacOSAudioCapture,
    convertStereoToMono,
    stopMacOSAudioCapture,
    setupGeminiIpcHandlers,
};
