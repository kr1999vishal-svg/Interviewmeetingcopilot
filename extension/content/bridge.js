/**
 * Bridge content script (runs on the web app's localhost origin).
 *
 * The web app cannot message the extension directly without knowing its ID, so
 * it uses window.postMessage. This bridge relays trusted messages to the
 * background service worker (e.g., to set the active meeting link + context).
 *
 * Web app usage:
 *   window.postMessage(
 *     { source: 'meeting-copilot', type: 'set-active-meeting',
 *       payload: { link, title, context } }, '*');
 */
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const data = event.data;
  if (!data || data.source !== 'meeting-copilot') return;

  if (data.type === 'set-active-meeting') {
    chrome.runtime.sendMessage(
      { type: 'setActiveMeeting', payload: data.payload || null },
      () => {
        // Acknowledge back to the page (optional).
        window.postMessage(
          { source: 'meeting-copilot-ext', type: 'active-meeting-saved' },
          '*',
        );
      },
    );
  }
});

// Announce the extension's presence so the web app can show "connected".
window.postMessage({ source: 'meeting-copilot-ext', type: 'ready' }, '*');
