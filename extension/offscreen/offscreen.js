/**
 * Offscreen document — privately transcribes the meeting tab's audio.
 *
 * The captured tab audio is the *remote participants'* voices (your own mic is
 * not part of the tab output), so this transcribes other members without
 * enabling in-meeting captions. Audio is recorded in short complete segments
 * and POSTed to the backend's /api/transcribe endpoint.
 */

const SEGMENT_MS = 5000; // length of each independently-decodable audio segment
const MIN_BYTES = 1500; // skip near-silent/empty segments

let stream = null;
let audioContext = null;
let recorder = null;
let running = false;
let cfg = null;

function pickMimeType() {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) || 'audio/webm';
}

function report(type, payload) {
  chrome.runtime.sendMessage({ from: 'offscreen', type, ...payload });
}

async function sendSegment(blob, mimeType) {
  try {
    // Fetch STT config from backend admin endpoint
    let sttConfig = { provider: 'openai', apiKey: '', model: 'whisper-1' };
    try {
      const configRes = await fetch(`${cfg.backendUrl.replace(/\/$/, '')}/api/admin/config`);
      if (configRes.ok) {
        const adminConfig = await configRes.json();
        sttConfig = {
          provider: adminConfig.sttProvider || 'openai',
          apiKey: adminConfig.sttApiKey || '',
          model: adminConfig.sttModel || 'whisper-1',
        };
      }
    } catch (configErr) {
      console.log('Failed to fetch admin config, using provided config:', configErr.message);
      // Fall back to provided config
      sttConfig = cfg.ai || { provider: 'openai', apiKey: '', model: 'whisper-1' };
    }

    if (!sttConfig.apiKey) {
      report('sttError', { error: 'STT API key not configured. Please set it in admin settings.' });
      return;
    }

    const buf = await blob.arrayBuffer();
    const res = await fetch(`${cfg.backendUrl.replace(/\/$/, '')}/api/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': mimeType,
        'x-ai-provider': sttConfig?.provider || 'openai',
        'x-ai-key': sttConfig?.apiKey || '',
        'x-stt-model': sttConfig?.model || 'whisper-1',
      },
      body: buf,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      report('sttError', { error: data.error || `Transcription failed (${res.status})` });
      return;
    }
    if (data.text) report('sttResult', { text: data.text, tabId: cfg.tabId });
  } catch (err) {
    report('sttError', { error: err?.message || 'Could not reach backend for transcription.' });
  }
}

function recordSegment(mimeType) {
  if (!running || !stream) return;
  const chunks = [];
  recorder = new MediaRecorder(stream, { mimeType });
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    if (blob.size >= MIN_BYTES) void sendSegment(blob, mimeType);
    if (running) recordSegment(mimeType); // start the next segment
  };
  recorder.start();
  setTimeout(() => {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, SEGMENT_MS);
}

async function start(message) {
  if (running) return;
  cfg = {
    backendUrl: message.backendUrl,
    ai: message.ai,
    tabId: message.tabId,
  };
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'tab',
          chromeMediaSourceId: message.streamId,
        },
      },
    });
  } catch (err) {
    report('sttError', { error: 'Could not capture tab audio: ' + (err?.message || err) });
    return;
  }

  // Keep playing the meeting audio to the user (capturing can otherwise mute it).
  audioContext = new AudioContext();
  const src = audioContext.createMediaStreamSource(stream);
  src.connect(audioContext.destination);

  running = true;
  report('sttStatus', { status: 'listening', tabId: cfg.tabId });
  recordSegment(pickMimeType());
}

function stop() {
  running = false;
  try {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  } catch {
    /* ignore */
  }
  recorder = null;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  if (audioContext) {
    void audioContext.close().catch(() => undefined);
    audioContext = null;
  }
  report('sttStatus', { status: 'idle', tabId: cfg?.tabId });
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.target !== 'offscreen') return;
  if (message.type === 'start') void start(message);
  else if (message.type === 'stop') stop();
});
