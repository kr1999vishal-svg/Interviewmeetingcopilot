/**
 * Orchestrator content script.
 *
 * - Loads config (active meeting link, AI creds via background).
 * - Gates activation so the overlay only runs on the meeting whose link was set.
 * - Polls captions, finalises lines, detects questions.
 * - Requests AI answers (via background -> backend) and optionally writes them
 *   into the meeting chat.
 */
(function () {
  const NS = window.MeetingCopilot;
  const { platform, overlay } = NS;
  if (!platform || platform.detect() === null) return;

  const POLL_MS = 1500;
  const MAX_CONTEXT_LINES = 12;
  const QUESTION_RE =
    /\b(what|why|how|when|where|who|which|whose|whom|can|could|would|should|do|does|did|is|are|am|was|were|will|may|might|have|has)\b/i;

  let config = null;
  let active = false;
  let userClosed = false; // track if user explicitly closed the overlay
  let prevTexts = [];
  const processed = new Set();
  const contextLines = [];
  let lastQuestion = '';
  let currentAnswer = '';
  let answering = false;
  let debugOn = false;
  let lastCaptionCount = 0;
  let processingAllowed = false;
  let listening = false;
  let usageInterval = null;
  let usageSeconds = 0; // private tab-audio transcription

  /* -------------------------- messaging helpers -------------------------- */
  const send = (message) =>
    new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (resp) => {
          // Handle extension context invalidation
          if (chrome.runtime.lastError) {
            console.log('Extension context invalidated, reloading page...');
            location.reload();
            return;
          }
          resolve(resp || { ok: false });
        });
      } catch (err) {
        console.log('Extension context error, reloading page:', err);
        location.reload();
      }
    });

  async function loadConfig() {
    const resp = await send({ type: 'getConfig' });
    config = resp.config || {};
    // Reset userClosed flag if config explicitly sets it to false
    if (config.userClosed === false) {
      userClosed = false;
    }
    return config;
  }

  /* ----------------------------- URL gating ------------------------------ */
  function tokenFromLink(link) {
    if (!link) return '';
    try {
      const decoded = decodeURIComponent(link);
      const meet = decoded.match(/meet\.google\.com\/([a-z0-9\-]+)/i);
      if (meet) return meet[1].toLowerCase();
      const teams = decoded.match(/meeting_[A-Za-z0-9]+/);
      if (teams) return teams[0].toLowerCase();
      const thread = decoded.match(/19:[^/@]+@thread\.v2/);
      if (thread) return thread[0].toLowerCase();
    } catch {
      /* ignore */
    }
    return '';
  }

  function matchesActiveMeeting() {
    const link = config?.activeMeeting?.link;
    if (!link) return { ok: true, reason: 'no-link' }; // no restriction configured
    const token = tokenFromLink(link);
    if (!token) return { ok: true, reason: 'untokenizable' };
    const href = decodeURIComponent(location.href).toLowerCase();
    return { ok: href.includes(token), reason: token };
  }

  /* --------------------------- caption polling --------------------------- */
  function isQuestion(text) {
    const t = text.trim();
    if (t.length < 6) return false;
    if (t.endsWith('?')) return true;
    return QUESTION_RE.test(t.split(/\s+/).slice(0, 3).join(' '));
  }

  function recentContext() {
    return contextLines.slice(-MAX_CONTEXT_LINES).join('\n');
  }

  async function answerQuestion(question, { auto } = {}) {
    if (!question || answering) return;
    answering = true;
    lastQuestion = question;
    overlay.setQuestion(question);
    overlay.setAnswer('Thinking…', true);
    const resp = await send({
      type: 'answer',
      payload: { 
        question, 
        transcript: recentContext(),
        title: config?.activeMeeting?.title,
        context: config?.activeMeeting?.context,
        fileIds: config?.activeMeeting?.fileIds || [],
      },
    });
    answering = false;
    if (resp.ok && resp.answer) {
      currentAnswer = resp.answer;
      overlay.setAnswer(currentAnswer, false);
      if (auto && config?.autoAnswer) {
        await platform.insertChatText(currentAnswer);
        if (config?.autoSend) await platform.sendChat();
      }
    } else {
      overlay.setAnswer('⚠ ' + (resp.error || 'Could not get an answer.'), false);
    }
  }

  function onFinalLine(line) {
    contextLines.push(`${line.speaker}: ${line.text}`);
    overlay.setTranscript(`${line.speaker}: ${line.text}`);
    // Only assist the meeting whose link was configured (requirement #4).
    if (!processingAllowed) return;
    if (isQuestion(line.text) && line.text !== lastQuestion) {
      answerQuestion(line.text, { auto: true });
    }
  }

  function renderDebug() {
    const match = matchesActiveMeeting();
    overlay.setDebug({
      platform: platform.detect() || 'unknown',
      'captions found': lastCaptionCount,
      'chat input': platform.hasChatInput() ? 'yes' : 'no',
      'lines processed': processed.size,
      'auto-answer': config?.autoAnswer ? 'on' : 'off',
      'gate token': match.reason,
      'gate match': match.ok ? 'yes' : 'no',
      url: location.href.slice(0, 80),
    });
  }

  function pollCaptions() {
    const lines = platform.getCaptionLines();
    lastCaptionCount = lines.length;
    if (debugOn) renderDebug();
    if (lines.length) {
      const texts = lines.map((l) => l.text);
      // A line is "final" once it has been identical for one poll cycle.
      for (const line of lines) {
        if (processed.has(line.text)) continue;
        if (prevTexts.includes(line.text)) {
          processed.add(line.text);
          onFinalLine(line);
        }
      }
      prevTexts = texts;
      // Always reflect the very latest (possibly in-progress) line.
      const last = lines[lines.length - 1];
      if (last && !answering) overlay.setTranscript(`${last.speaker}: ${last.text}`);
    }
  }

  /* ------------------------------ lifecycle ------------------------------ */
  async function activate() {
    if (active) return;
    active = true;
    overlay.mount();
    overlay.setAuto(Boolean(config?.autoAnswer));
    overlay.setMeetingTitle(config?.activeMeeting?.title || 'Meeting Copilot');

    // Auto-start transcription if on the configured meeting
    const match = matchesActiveMeeting();
    if (match.ok && !listening) {
      const resp = await send({ type: 'startCapture' });
      if (resp.ok) {
        listening = true;
        overlay.setListening(true);
        overlay.setStatus('Auto-starting private transcription…', 'ok');
        startUsageTracking();
      }
    }

    overlay.on('answer', () => {
      const q = lastQuestion || contextLines[contextLines.length - 1] || '';
      answerQuestion(q, { auto: false });
    });
    overlay.on('insert', async () => {
      if (currentAnswer) await platform.insertChatText(currentAnswer);
    });
    overlay.on('send', async () => {
      if (!currentAnswer) return;
      await platform.insertChatText(currentAnswer);
      await platform.sendChat();
    });
    overlay.on('toggleAuto', async () => {
      const next = !config.autoAnswer;
      const resp = await send({ type: 'setConfig', patch: { autoAnswer: next } });
      config = resp.config || { ...config, autoAnswer: next };
      overlay.setAuto(Boolean(config.autoAnswer));
    });
    overlay.on('close', () => {
      userClosed = true;
      // Persist the userClosed flag to storage
      send({ type: 'setConfig', patch: { userClosed: true } });
      deactivate();
    });
    overlay.on('toggleListen', async () => {
      if (listening) {
        await send({ type: 'stopCapture' });
        listening = false;
        overlay.setListening(false);
        overlay.setStatus('Private transcription stopped.', 'ok');
        stopUsageTracking();
      } else {
        const resp = await send({ type: 'startCapture' });
        if (resp.ok) {
          listening = true;
          overlay.setListening(true);
          overlay.setStatus('Starting private transcription…', 'ok');
          startUsageTracking();
        } else {
          overlay.setStatus('⚠ ' + (resp.error || 'Failed to start capture'), 'warn');
        }
      }
    });

    updateGateStatus();
  }

  /** Recompute whether AI assistance is allowed and reflect it in the overlay. */
  function updateGateStatus() {
    const match = matchesActiveMeeting();
    processingAllowed = match.ok;
    overlay.setMeetingTitle(config?.activeMeeting?.title || 'Meeting Copilot');
    overlay.setAuto(Boolean(config?.autoAnswer));
    if (match.reason === 'no-link') {
      overlay.setStatus('No active meeting set — open the extension popup.', 'warn');
    } else if (!match.ok) {
      overlay.setStatus('Not the configured meeting — assistance paused.', 'warn');
    } else {
      overlay.setStatus('Listening to captions…', 'ok');
    }
  }

  async function startUsageTracking() {
    if (usageInterval) return;
    
    // Check user usage first
    try {
      const backendUrl = config?.backendUrl || 'https://interview-ai-backend-tlka.onrender.com';
      const email = config?.user?.email;
      if (!email) {
        overlay.setStatus('Please sign in to track usage.', 'warn');
        return;
      }

      const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/admin/usage?email=${encodeURIComponent(email)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.user) {
          if (data.user.remaining_seconds <= 0) {
            overlay.setStatus('Time expired. Please purchase a plan.', 'warn');
            // Redirect to payment page
            window.open('https://interviewmeetingcopilot.vercel.app/payment', '_blank');
            return;
          }
          usageSeconds = 0;
        }
      }
    } catch (err) {
      console.log('Failed to check usage:', err);
    }

    // Start tracking
    usageInterval = setInterval(async () => {
      usageSeconds++;
      
      // Update usage every 10 seconds
      if (usageSeconds % 10 === 0) {
        try {
          const backendUrl = config?.backendUrl || 'https://interview-ai-backend-tlka.onrender.com';
          const email = config?.user?.email;
          if (email) {
            await fetch(`${backendUrl.replace(/\/$/, '')}/api/admin/usage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email, seconds: 10 }),
            });
          }
        } catch (err) {
          console.log('Failed to update usage:', err);
        }
      }

      // Check if time expired (30 seconds free trial or paid plan)
      if (usageSeconds >= 30 && !config?.user?.hasPaid) {
        stopUsageTracking();
        overlay.setStatus('Free trial expired. Please purchase a plan.', 'warn');
        window.open('https://interviewmeetingcopilot.vercel.app/payment', '_blank');
      }
    }, 1000);
  }

  function stopUsageTracking() {
    if (usageInterval) {
      clearInterval(usageInterval);
      usageInterval = null;
    }
  }

  function deactivate() {
    if (!active) return;
    active = false;
    stopUsageTracking();
    overlay.destroy();
  }

  async function evaluateGate() {
    await loadConfig();
    if (config?.enabled === false) return deactivate();
    // Don't re-activate if user explicitly closed it
    if (userClosed) return;
    // Always show the overlay on a meeting page; gating only controls whether
    // AI assistance runs, so diagnostics remain available either way.
    activate();
    updateGateStatus();
  }

  // React to config changes (e.g., user sets the active meeting in the popup).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.config) {
      const oldConfig = changes.config.oldValue || {};
      const newConfig = changes.config.newValue;
      config = newConfig;
      
      // Only reset userClosed if explicitly set to false in the new config
      if (newConfig.userClosed === false) {
        userClosed = false;
      } else if (newConfig.userClosed === true) {
        userClosed = true;
      }
      
      // Don't re-evaluate if the only change is userClosed being set to true (user closing)
      // This prevents the overlay from re-appearing immediately after closing
      const isOnlyUserClosedChange = 
        Object.keys(oldConfig).length === Object.keys(newConfig).length &&
        Object.keys(oldConfig).every(key => {
          if (key === 'userClosed') return true; // ignore userClosed differences
          return oldConfig[key] === newConfig[key];
        });
      
      if (!isOnlyUserClosedChange || newConfig.userClosed === false) {
        evaluateGate();
      }
    }
  });

  // Handle manual recheck request from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'recheckConfig') {
      loadConfig().then(() => {
        userClosed = false; // Reset the close flag
        evaluateGate();
      });
      sendResponse({ ok: true });
    }
    return true;
  });

  // Handle STT transcripts, errors, and status from the background script.
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'sttTranscript') {
      contextLines.push(`Private: ${message.text}`);
      overlay.setTranscript(`Private: ${message.text}`);
      if (debugOn) renderDebug();
    } else if (message.type === 'sttError') {
      listening = false;
      overlay.setListening(false);
      overlay.setStatus('⚠ Transcription error: ' + message.error, 'warn');
    } else if (message.type === 'sttStatus') {
      if (message.status === 'listening') {
        overlay.setStatus('Privately transcribing meeting audio…', 'ok');
      } else if (message.status === 'idle') {
        overlay.setStatus('Private transcription idle.', 'ok');
      }
    }
  });

  // Initial start + periodic re-evaluation (SPA navigation, late captions).
  evaluateGate();
  setInterval(() => {
    if (active) pollCaptions();
    else evaluateGate();
  }, POLL_MS);

  // Also re-check gating on SPA URL changes.
  let lastHref = location.href;
  setInterval(() => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      evaluateGate();
    }
  }, 2000);
})();
