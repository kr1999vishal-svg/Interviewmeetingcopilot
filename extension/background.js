/**
 * Meeting Copilot — background service worker (MV3).
 *
 * Responsibilities:
 *  - Hold/return configuration (backend URL, AI credentials, active meeting).
 *  - Proxy AI "answer" requests to the backend (host_permissions let the worker
 *    bypass page CORS), keeping API keys out of the meeting page context.
 *  - Receive the active meeting (link + context) pushed from the web app via the
 *    localhost bridge content script.
 */

const DEFAULT_CONFIG = {
  backendUrl: 'http://localhost:4000',
  aiProvider: 'openai',
  aiApiKey: '',
  aiModel: '',
  autoAnswer: false,
  autoSend: false,
  enabled: true,
  // { link, title, context, fileIds } — the only meeting the overlay will activate for.
  activeMeeting: null,
  user: null,
};

async function getConfig() {
  const stored = await chrome.storage.local.get('config');
  const localConfig = { ...DEFAULT_CONFIG, ...(stored.config || {}) };
  
  // Fetch AI configuration from backend admin endpoint
  try {
    const res = await fetch(`${localConfig.backendUrl.replace(/\/$/, '')}/api/admin/config`);
    if (res.ok) {
      const adminConfig = await res.json();
      // Merge admin AI config with local config
      return {
        ...localConfig,
        aiProvider: adminConfig.aiProvider || localConfig.aiProvider,
        aiApiKey: adminConfig.apiKey || localConfig.aiApiKey,
        aiModel: adminConfig.model || localConfig.aiModel,
      };
    }
  } catch (error) {
    console.log('Failed to fetch admin config, using local config:', error.message);
  }
  
  return localConfig;
}

async function setConfig(patch) {
  const current = await getConfig();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ config: next });
  return next;
}

/** Call the backend /api/answer endpoint with the configured AI credentials. */
async function requestAnswer({ question, transcript }) {
  const cfg = await getConfig();
  const body = {
    question,
    transcript: transcript || '',
    title: cfg.activeMeeting?.title || '',
    context: cfg.activeMeeting?.context || '',
    ai: {
      provider: cfg.aiProvider,
      apiKey: cfg.aiApiKey,
      model: cfg.aiModel || undefined,
    },
  };

  const res = await fetch(`${cfg.backendUrl.replace(/\/$/, '')}/api/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = `Answer request failed (${res.status})`;
    try {
      const err = await res.json();
      if (err?.error) message = err.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  return res.json();
}

/* --------------------- private tab-audio transcription ------------------- */

let capturingTabId = null;

async function ensureOffscreen() {
  // hasDocument may be undefined on older Chrome; guard it.
  const has = await chrome.offscreen?.hasDocument?.();
  if (has) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen/offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Transcribe the meeting tab audio locally and privately.',
  });
}

async function startCapture(tabId) {
  if (capturingTabId === tabId) return;
  const cfg = await getConfig();
  // streamId for the target tab; usable by getUserMedia in the offscreen doc.
  const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
  await ensureOffscreen();
  await chrome.runtime.sendMessage({
    target: 'offscreen',
    type: 'start',
    streamId,
    tabId,
    backendUrl: cfg.backendUrl,
    ai: { provider: cfg.aiProvider, apiKey: cfg.aiApiKey },
  });
  capturingTabId = tabId;
}

async function stopCapture() {
  await chrome.runtime.sendMessage({ target: 'offscreen', type: 'stop' }).catch(() => {});
  try {
    if (await chrome.offscreen?.hasDocument?.()) await chrome.offscreen.closeDocument();
  } catch {
    /* ignore */
  }
  capturingTabId = null;
}

// Relay transcripts/status coming from the offscreen document to the content
// script of the captured tab.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.from !== 'offscreen') return;
  const tabId = message.tabId ?? capturingTabId;
  if (tabId == null) return;
  if (message.type === 'sttResult') {
    chrome.tabs.sendMessage(tabId, { type: 'sttTranscript', text: message.text }).catch(() => {});
  } else if (message.type === 'sttError') {
    chrome.tabs.sendMessage(tabId, { type: 'sttError', error: message.error }).catch(() => {});
  } else if (message.type === 'sttStatus') {
    chrome.tabs.sendMessage(tabId, { type: 'sttStatus', status: message.status }).catch(() => {});
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.from === 'offscreen') return; // handled by the relay listener
  (async () => {
    try {
      switch (message?.type) {
        case 'getConfig':
          sendResponse({ ok: true, config: await getConfig() });
          break;
        case 'startCapture': {
          const tabId = sender?.tab?.id ?? message.tabId;
          if (tabId == null) throw new Error('No tab to capture.');
          await startCapture(tabId);
          sendResponse({ ok: true });
          break;
        }
        case 'stopCapture':
          await stopCapture();
          sendResponse({ ok: true });
          break;
        case 'setConfig':
          sendResponse({ ok: true, config: await setConfig(message.patch || {}) });
          break;
        case 'setActiveMeeting':
          sendResponse({
            ok: true,
            config: await setConfig({ activeMeeting: message.payload || null }),
          });
          break;
        case 'answer': {
          const result = await requestAnswer(message.payload || {});
          sendResponse({ ok: true, ...result });
          break;
        }
        default:
          sendResponse({ ok: false, error: 'Unknown message type' });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || 'Background error' });
    }
  })();
  // Keep the message channel open for the async response.
  return true;
});
