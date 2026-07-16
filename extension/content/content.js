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
  console.log('Meeting Copilot content script loaded');
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
  let usageSeconds = 0;
  let isTimeExpired = false; // Track if time has expired

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
    // Faster detection - check for question mark first
    if (t.endsWith('?')) return true;
    // Check for question words at the start (faster than regex)
    const questionWords = ['what', 'how', 'why', 'when', 'where', 'who', 'which', 'can', 'could', 'would', 'should', 'is', 'are', 'do', 'does', 'did', 'tell', 'explain', 'describe', 'define'];
    const firstWord = t.split(/\s+/)[0]?.toLowerCase();
    return questionWords.includes(firstWord);
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
    // Don't process if time has expired
    if (isTimeExpired) return;
    
    contextLines.push(`${line.speaker}: ${line.text}`);
    overlay.setTranscript(`${line.speaker}: ${line.text}`);
    
    // Debug: log the text being processed
    console.log('Processing line:', line.text);
    console.log('processingAllowed:', processingAllowed);
    console.log('isQuestion:', isQuestion(line.text));
    
    // Only assist the meeting whose link was configured (requirement #4).
    if (!processingAllowed) return;
    if (isQuestion(line.text) && line.text !== lastQuestion) {
      console.log('Question detected:', line.text);
      overlay.setQuestion(line.text);
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

    // Check if user has paid before starting transcription
    const hasPaid = await checkPaymentStatus();
    if (!hasPaid) {
      overlay.setStatus('Payment required to start meeting assistance', 'warn');
      showPaymentUI();
      return;
    }

    // Auto-start transcription always when overlay is activated
    if (!listening) {
      const resp = await send({ type: 'startCapture' });
      if (resp.ok) {
        listening = true;
        overlay.setListening(true);
        overlay.setStatus('Listening to meeting audio…', 'ok');
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
    overlay.on('setupMeeting', async () => {
      const setup = overlay.getMeetingSetup();
      const resp = await send({ type: 'setConfig', patch: { activeMeeting: setup } });
      config = resp.config || { ...config, activeMeeting: setup };
      overlay.setSetupVisible(false);
      updateGateStatus();
    });
    overlay.on('purchasePlan', async (plan) => {
      try {
        console.log('Purchase plan clicked:', plan);
        overlay.setStatus('Initializing payment...', 'ok');
        
        const email = config?.user?.email;
        if (!email) {
          console.error('No email found in config');
          overlay.setStatus('Please sign in first', 'warn');
          return;
        }

        console.log('User email:', email);
        overlay.setStatus('Creating payment order...', 'ok');
        
        const backendUrl = config?.backendUrl || 'https://interview-ai-backend-tlka.onrender.com';
        console.log('Backend URL:', backendUrl);
        
        const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/admin/create-order`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, planId: plan.id }),
        });

        console.log('Order response status:', res.status);
        
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}));
          console.error('Order creation failed:', errorData);
          throw new Error(errorData.error || 'Failed to create order');
        }

        const data = await res.json();
        console.log('Order created:', data);
        overlay.setStatus('Opening payment gateway...', 'ok');
        
        // Load Razorpay checkout script if not loaded
        if (!window.Razorpay) {
          console.log('Loading Razorpay script...');
          overlay.setStatus('Loading payment gateway...', 'ok');
          const script = document.createElement('script');
          script.src = 'https://checkout.razorpay.com/v1/checkout.js';
          script.onload = () => {
            console.log('Razorpay script loaded, opening checkout');
            overlay.setStatus('Opening checkout...', 'ok');
            openRazorpayCheckout(data.order, plan, email);
          };
          script.onerror = () => {
            console.error('Failed to load Razorpay script');
            overlay.setStatus('Failed to load payment gateway. Please try again.', 'warn');
          };
          document.head.appendChild(script);
        } else {
          console.log('Razorpay already loaded, opening checkout');
          overlay.setStatus('Opening checkout...', 'ok');
          openRazorpayCheckout(data.order, plan, email);
        }
      } catch (err) {
        console.error('Payment error:', err);
        overlay.setStatus('Payment failed: ' + err.message, 'warn');
      }
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
  async function updateGateStatus() {
    const match = matchesActiveMeeting();
    processingAllowed = match.ok;
    overlay.setMeetingTitle(config?.activeMeeting?.title || 'Meeting Copilot');
    overlay.setAuto(Boolean(config?.autoAnswer));
    
    // Check payment status first
    const hasPaid = await checkPaymentStatus();
    if (!hasPaid) {
      overlay.setStatus('Payment required to start meeting assistance', 'warn');
      showPaymentUI();
      overlay.setSetupVisible(false);
      processingAllowed = false;
      return;
    }
    
    // Show meeting setup if no active meeting
    if (match.reason === 'no-link') {
      overlay.setStatus('No active meeting set — configure below:', 'warn');
      overlay.setSetupVisible(true);
      // Check API health when showing setup
      checkApiHealth();
    } else if (!match.ok) {
      overlay.setStatus('Not the configured meeting — assistance paused.', 'warn');
      overlay.setSetupVisible(false);
    } else {
      overlay.setStatus('Listening to captions…', 'ok');
      overlay.setSetupVisible(false);
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
            // Show payment UI in overlay
            showPaymentUI();
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

    }, 1000);
  }

  async function showPaymentUI() {
    try {
      const backendUrl = config?.backendUrl || 'https://interview-ai-backend-tlka.onrender.com';
      const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/admin/plans`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.plans) {
          overlay.setPaymentPlans(data.plans);
          overlay.setPaymentVisible(true);
        }
      }
    } catch (err) {
      console.error('Failed to load payment plans:', err);
    }
  }

  async function checkPaymentStatus() {
    try {
      const backendUrl = config?.backendUrl || 'https://interview-ai-backend-tlka.onrender.com';
      const email = config?.user?.email;
      if (!email) return false;

      const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/admin/usage?email=${encodeURIComponent(email)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.user) {
          // User has paid only if they have a valid plan (current_plan_id)
          // remaining_seconds alone is not enough - they need an actual plan
          return Boolean(data.user.current_plan_id);
        }
      }
      return false;
    } catch (err) {
      console.error('Failed to check payment status:', err);
      return false;
    }
  }

  async function checkApiHealth() {
    try {
      const backendUrl = config?.backendUrl || 'https://interview-ai-backend-tlka.onrender.com';
      overlay.setHealthStatus('loading', 'Checking API status...');
      
      const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/admin/health`);
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          overlay.setHealthStatus('ok', '✓ AI assistance ready');
          overlay.setSetupEnabled(true);
        } else {
          let errorMsg = 'API check failed: ';
          if (data.aiError) errorMsg += `AI: ${data.aiError}. `;
          if (data.sttError) errorMsg += `STT: ${data.sttError}. `;
          overlay.setHealthStatus('error', errorMsg);
          overlay.setSetupEnabled(false);
        }
      } else {
        overlay.setHealthStatus('error', 'Failed to check API status');
        overlay.setSetupEnabled(false);
      }
    } catch (err) {
      console.error('Failed to check API health:', err);
      overlay.setHealthStatus('error', 'Could not connect to backend');
      overlay.setSetupEnabled(false);
    }
  }

  function stopUsageTracking() {
    if (usageInterval) {
      clearInterval(usageInterval);
      usageInterval = null;
    }
  }

  async function openRazorpayCheckout(order, plan, email) {
    console.log('Opening Razorpay checkout with order:', order);
    
    if (!window.Razorpay) {
      console.error('Razorpay not loaded');
      overlay.setStatus('Payment gateway not loaded. Please refresh and try again.', 'warn');
      return;
    }

    try {
      const options = {
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        name: 'Meeting Copilot',
        description: plan.name,
        order_id: order.id,
        handler: async function (response) {
          try {
            const backendUrl = config?.backendUrl || 'https://interview-ai-backend-tlka.onrender.com';
            const res = await fetch(`${backendUrl.replace(/\/$/, '')}/api/admin/verify-payment`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                razorpay_order_id: response.razorpay_order_id,
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature,
                email,
              }),
            });

            if (res.ok) {
              overlay.setStatus('Payment successful! Meeting Copilot is now active.', 'ok');
              overlay.setPaymentVisible(false);
              // Reload config to get updated plan
              await loadConfig();
              // Reset time expired flag
              isTimeExpired = false;
              // Restart usage tracking
              usageSeconds = 0;
              startUsageTracking();
            } else {
              overlay.setStatus('Payment verification failed. Please contact support.', 'warn');
            }
          } catch (err) {
            console.error('Payment verification error:', err);
            overlay.setStatus('Payment verification failed. Please try again.', 'warn');
          }
        },
        prefill: {
          email: email,
        },
        theme: {
          color: '#4F46E5',
        },
        modal: {
          ondismiss: function() {
            console.log('Razorpay modal dismissed');
            overlay.setStatus('Payment cancelled. You can try again anytime.', 'warn');
          }
        }
      };

      console.log('Creating Razorpay instance with options:', options);
      const rzp = new window.Razorpay(options);
      
      rzp.on('payment.failed', function (response) {
        console.error('Payment failed:', response);
        overlay.setStatus('Payment failed: ' + response.error.description, 'warn');
      });
      
      console.log('Opening Razorpay modal');
      rzp.open();
    } catch (err) {
      console.error('Failed to open Razorpay checkout:', err);
      overlay.setStatus('Failed to open payment gateway. Please try again.', 'warn');
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
      console.log('Received STT transcript:', message.text);
      contextLines.push(`Private: ${message.text}`);
      overlay.setTranscript(`Private: ${message.text}`);
      
      // Also process for question detection
      const text = message.text;
      console.log('Processing STT text for question:', text);
      console.log('processingAllowed:', processingAllowed);
      console.log('isQuestion:', isQuestion(text));
      
      if (!isTimeExpired && processingAllowed && isQuestion(text) && text !== lastQuestion) {
        console.log('Question detected from STT:', text);
        overlay.setQuestion(text);
        answerQuestion(text, { auto: true });
      }
      
      if (debugOn) renderDebug();
    } else if (message.type === 'sttError') {
      console.error('STT Error:', message.error);
      listening = false;
      overlay.setListening(false);
      overlay.setStatus('⚠ Transcription error: ' + message.error, 'warn');
    } else if (message.type === 'sttStatus') {
      console.log('STT Status:', message.status);
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
