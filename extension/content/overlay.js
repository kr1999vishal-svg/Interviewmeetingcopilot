/**
 * Floating, draggable copilot overlay injected into the meeting page.
 * Exposes window.MeetingCopilot.overlay with an imperative API used by
 * content.js. Pure DOM (no framework) so it can run as a plain content script.
 */
(function () {
  const NS = (window.MeetingCopilot = window.MeetingCopilot || {});
  const POS_KEY = 'mc-overlay-pos';

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  class Overlay {
    constructor() {
      this.handlers = {};
      this.autoAnswer = false;
      this.root = null;
    }

    on(event, fn) {
      this.handlers[event] = fn;
      return this;
    }

    emit(event, ...args) {
      this.handlers[event]?.(...args);
    }

    mount() {
      if (this.root) return;
      const root = el('div', 'mc-overlay');
      root.id = 'mc-overlay-root';

      // Header (drag handle + controls)
      const header = el('div', 'mc-header');
      header.appendChild(el('span', 'mc-dot'));
      this.titleEl = el('span', 'mc-title', 'Meeting Copilot');
      header.appendChild(this.titleEl);
      const spacer = el('div', 'mc-spacer');
      header.appendChild(spacer);

      this.listenBtn = el('button', 'mc-chip', 'Listen');
      this.listenBtn.title = 'Privately transcribe the meeting audio (tab audio)';
      this.listenBtn.onclick = () => this.emit('toggleListen');
      header.appendChild(this.listenBtn);

      this.autoBtn = el('button', 'mc-chip', 'Auto: Off');
      this.autoBtn.title = 'Toggle automatic answers';
      this.autoBtn.onclick = () => this.emit('toggleAuto');
      header.appendChild(this.autoBtn);

      this.debugBtn = el('button', 'mc-chip', 'Debug');
      this.debugBtn.title = 'Toggle caption/chat detection diagnostics';
      this.debugBtn.onclick = () => this.emit('toggleDebug');
      header.appendChild(this.debugBtn);

      this.closeBtn = el('button', 'mc-icon-btn mc-close-btn', '×');
      this.closeBtn.title = 'Close Meeting Copilot';
      this.closeBtn.onclick = () => this.emit('close');
      header.appendChild(this.closeBtn);

      this.minBtn = el('button', 'mc-icon-btn', '–');
      this.minBtn.onclick = () => root.classList.toggle('mc-collapsed');
      header.appendChild(this.minBtn);
      root.appendChild(header);

      // Body
      const body = el('div', 'mc-body');

      this.statusEl = el('div', 'mc-status', 'Waiting for meeting…');
      body.appendChild(this.statusEl);

      body.appendChild(el('div', 'mc-label', 'Latest'));
      this.transcriptEl = el('div', 'mc-transcript', '—');
      body.appendChild(this.transcriptEl);

      body.appendChild(el('div', 'mc-label', 'Detected question'));
      this.questionEl = el('div', 'mc-question', '—');
      body.appendChild(this.questionEl);

      body.appendChild(el('div', 'mc-label', 'Suggested answer'));
      this.answerEl = el('div', 'mc-answer', '—');
      body.appendChild(this.answerEl);

      const actions = el('div', 'mc-actions');
      this.answerBtn = el('button', 'mc-btn', 'Answer');
      this.answerBtn.onclick = () => this.emit('answer');
      this.insertBtn = el('button', 'mc-btn', 'Insert to chat');
      this.insertBtn.onclick = () => this.emit('insert');
      this.sendBtn = el('button', 'mc-btn mc-btn-primary', 'Insert + Send');
      this.sendBtn.onclick = () => this.emit('send');
      actions.append(this.answerBtn, this.insertBtn, this.sendBtn);
      body.appendChild(actions);

      // Diagnostics panel (hidden until Debug is toggled).
      this.debugEl = el('pre', 'mc-debug');
      this.debugEl.style.display = 'none';
      body.appendChild(this.debugEl);

      root.appendChild(body);
      document.documentElement.appendChild(root);
      this.root = root;

      this.restorePosition();
      this.makeDraggable(header);
    }

    makeDraggable(handle) {
      let startX = 0, startY = 0, originX = 0, originY = 0, dragging = false;
      const onDown = (e) => {
        if (e.target.tagName === 'BUTTON') return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = this.root.getBoundingClientRect();
        originX = rect.left;
        originY = rect.top;
        e.preventDefault();
      };
      const onMove = (e) => {
        if (!dragging) return;
        const x = Math.max(0, originX + (e.clientX - startX));
        const y = Math.max(0, originY + (e.clientY - startY));
        this.root.style.left = x + 'px';
        this.root.style.top = y + 'px';
        this.root.style.right = 'auto';
      };
      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        try {
          localStorage.setItem(
            POS_KEY,
            JSON.stringify({ left: this.root.style.left, top: this.root.style.top }),
          );
        } catch {
          /* ignore */
        }
      };
      handle.addEventListener('mousedown', onDown);
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    }

    restorePosition() {
      try {
        const raw = localStorage.getItem(POS_KEY);
        if (raw) {
          const pos = JSON.parse(raw);
          if (pos.left) {
            this.root.style.left = pos.left;
            this.root.style.top = pos.top;
            this.root.style.right = 'auto';
          }
        }
      } catch {
        /* ignore */
      }
    }

    setStatus(text, tone) {
      if (!this.statusEl) return;
      this.statusEl.textContent = text;
      this.statusEl.className = 'mc-status' + (tone ? ' mc-status-' + tone : '');
    }

    setMeetingTitle(title) {
      if (this.titleEl) this.titleEl.textContent = title || 'Meeting Copilot';
    }

    setTranscript(text) {
      if (this.transcriptEl) this.transcriptEl.textContent = text || '—';
    }

    setQuestion(text) {
      if (this.questionEl) this.questionEl.textContent = text || '—';
    }

    setAnswer(text, loading) {
      if (!this.answerEl) return;
      this.answerEl.textContent = text || '—';
      this.answerEl.classList.toggle('mc-loading', Boolean(loading));
    }

    setAuto(on) {
      this.autoAnswer = on;
      if (this.autoBtn) {
        this.autoBtn.textContent = 'Auto: ' + (on ? 'On' : 'Off');
        this.autoBtn.classList.toggle('mc-chip-on', on);
      }
    }

    setListening(on) {
      if (this.listenBtn) {
        this.listenBtn.textContent = on ? 'Listening…' : 'Listen';
        this.listenBtn.classList.toggle('mc-chip-on', on);
      }
    }

    setDebugVisible(on) {
      if (this.debugEl) this.debugEl.style.display = on ? 'block' : 'none';
      if (this.debugBtn) this.debugBtn.classList.toggle('mc-chip-on', on);
    }

    setDebug(info) {
      if (!this.debugEl) return;
      const lines = Object.entries(info).map(([k, v]) => `${k}: ${v}`);
      this.debugEl.textContent = lines.join('\n');
    }

    destroy() {
      this.root?.remove();
      this.root = null;
    }
  }

  NS.overlay = new Overlay();
})();
