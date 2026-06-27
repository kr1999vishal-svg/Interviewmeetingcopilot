/**
 * Platform abstraction for Google Meet and Microsoft Teams.
 *
 * Captions and chat DOM in these apps use obfuscated, frequently-changing class
 * names. Selectors are centralised here with several fallbacks so they are easy
 * to update if Google/Microsoft change their markup.
 *
 * Exposes: window.MeetingCopilot.platform
 *   detect()            -> 'meet' | 'teams' | null
 *   getCaptionLines()   -> [{ speaker, text }]
 *   openChat()          -> Promise<boolean>
 *   insertChatText(t)   -> Promise<boolean>
 *   sendChat()          -> Promise<boolean>
 */
(function () {
  const NS = (window.MeetingCopilot = window.MeetingCopilot || {});

  const text = (el) => (el ? (el.textContent || '').trim() : '');
  const visible = (el) =>
    el && el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';

  const firstMatch = (selectors, root = document) => {
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    return null;
  };

  const allMatches = (selectors, root = document) => {
    for (const sel of selectors) {
      const els = root.querySelectorAll(sel);
      if (els.length) return Array.from(els);
    }
    return [];
  };

  /** Set the value of a React-controlled input/textarea and fire input. */
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function pressEnter(el) {
    const opts = { bubbles: true, cancelable: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
  }

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ----------------------------- Google Meet ----------------------------- */
  const meet = {
    captionLines() {
      // The captions region; inside are repeated [speaker, text] blocks.
      const region =
        firstMatch([
          'div[aria-label="Captions"]',
          'div[jsname="dsyhDe"]',
          '.a4cQT',
        ]) || document;
      const blocks = allMatches(
        [
          '.nMcdL', // each caption row (subject to change)
          '.TBMuR',
          'div[data-message-text]',
        ],
        region,
      );
      if (blocks.length) {
        return blocks
          .map((b) => {
            const speaker = text(
              firstMatch(['.zs7s8d', '.jxFHg', '.NWpY1d', '[data-self-name]'], b),
            );
            const line = text(
              firstMatch(['.bh44bd', '.iTTPOb', '.VbkSUe', 'div'], b),
            );
            return { speaker: speaker || 'Speaker', text: line };
          })
          .filter((l) => l.text);
      }
      // Fallback: treat the whole region text as one rolling line.
      const t = text(region);
      return t ? [{ speaker: 'Speaker', text: t }] : [];
    },
    async openChat() {
      const input = firstMatch(['textarea[aria-label*="Send a message"]']);
      if (input && visible(input)) return true;
      const btn = firstMatch([
        'button[aria-label*="Chat with everyone"]',
        'button[aria-label*="Chat"]',
      ]);
      if (btn) {
        btn.click();
        await delay(500);
        return true;
      }
      return false;
    },
    chatInput() {
      return firstMatch([
        'textarea[aria-label*="Send a message"]',
        'textarea[aria-label*="message"]',
      ]);
    },
    async insertChatText(value) {
      await this.openChat();
      const input = this.chatInput();
      if (!input) return false;
      input.focus();
      setNativeValue(input, value);
      return true;
    },
    async sendChat() {
      const input = this.chatInput();
      if (!input) return false;
      const sendBtn = firstMatch([
        'button[aria-label*="Send a message"]',
        'button[aria-label*="Send message"]',
      ]);
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
        return true;
      }
      pressEnter(input);
      return true;
    },
  };

  /* --------------------------- Microsoft Teams --------------------------- */
  const teams = {
    captionLines() {
      const blocks = allMatches([
        '[data-tid="closed-caption-text"]',
        '.ui-chat__item .ui-chat__message',
        '[class*="closedCaption"] [class*="captionText"]',
      ]);
      if (blocks.length) {
        return blocks
          .map((b) => {
            const container = b.closest('[data-tid], .ui-chat__item') || b;
            const speaker = text(
              firstMatch(
                ['[data-tid="author"]', '.ui-chat__message__author', '[class*="author"]'],
                container,
              ),
            );
            return { speaker: speaker || 'Speaker', text: text(b) };
          })
          .filter((l) => l.text);
      }
      return [];
    },
    chatInput() {
      return firstMatch([
        'div[data-tid="ckeditor"][contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
      ]);
    },
    async openChat() {
      if (this.chatInput()) return true;
      const btn = firstMatch([
        'button[data-tid="chat-button"]',
        'button[aria-label*="chat" i]',
        'button[aria-label*="conversation" i]',
      ]);
      if (btn) {
        btn.click();
        await delay(600);
      }
      return Boolean(this.chatInput());
    },
    async insertChatText(value) {
      await this.openChat();
      const input = this.chatInput();
      if (!input) return false;
      input.focus();
      // contenteditable: replace content and notify the editor.
      input.textContent = value;
      input.dispatchEvent(
        new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }),
      );
      return true;
    },
    async sendChat() {
      const input = this.chatInput();
      if (!input) return false;
      const sendBtn = firstMatch([
        'button[data-tid="newMessageCommands-send"]',
        'button[name="send"]',
        'button[aria-label*="Send" i]',
      ]);
      if (sendBtn && !sendBtn.disabled) {
        sendBtn.click();
        return true;
      }
      pressEnter(input);
      return true;
    },
  };

  function detect() {
    const host = location.hostname;
    if (host.includes('meet.google.com')) return 'meet';
    if (host.includes('teams.microsoft.com') || host.includes('teams.live.com'))
      return 'teams';
    return null;
  }

  function impl() {
    return detect() === 'meet' ? meet : detect() === 'teams' ? teams : null;
  }

  NS.platform = {
    detect,
    getCaptionLines: () => impl()?.captionLines() ?? [],
    openChat: () => impl()?.openChat() ?? Promise.resolve(false),
    insertChatText: (t) => impl()?.insertChatText(t) ?? Promise.resolve(false),
    sendChat: () => impl()?.sendChat() ?? Promise.resolve(false),
    /** Whether the meeting chat input is currently in the DOM (diagnostics). */
    hasChatInput: () => Boolean(impl()?.chatInput?.()),
  };
})();
