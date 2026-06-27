import type { Meeting } from '@/types';

/**
 * Bridge to the Meeting Copilot browser extension.
 *
 * The web app cannot message the extension directly (it doesn't know the
 * extension ID), so it uses window.postMessage. The extension's localhost
 * content script (`bridge.js`) relays these to its background worker.
 */

interface ActiveMeetingPayload {
  link: string;
  title: string;
  context: string;
}

/** Build a compact context string from the meeting's brief / agenda / notes. */
function buildContext(meeting: Meeting): string {
  const parts: string[] = [];
  if (meeting.description) parts.push(meeting.description);
  if (meeting.agenda?.length) parts.push(`Agenda:\n- ${meeting.agenda.join('\n- ')}`);
  if (meeting.brief?.summary) parts.push(`Brief: ${meeting.brief.summary}`);
  if (meeting.brief?.importantFacts?.length) {
    parts.push(`Key facts:\n- ${meeting.brief.importantFacts.join('\n- ')}`);
  }
  if (meeting.notes?.trim()) parts.push(`Notes: ${meeting.notes.trim()}`);
  return parts.join('\n\n').slice(0, 6000);
}

/**
 * Push the active meeting (link + context) to the extension so its overlay
 * activates only for this meeting. No-op if the meeting has no link.
 */
export function pushActiveMeetingToExtension(meeting: Meeting): void {
  if (!meeting.meetingUrl) return;
  const payload: ActiveMeetingPayload = {
    link: meeting.meetingUrl,
    title: meeting.title,
    context: buildContext(meeting),
  };
  window.postMessage(
    { source: 'meeting-copilot', type: 'set-active-meeting', payload },
    '*',
  );
}

/**
 * Whether the extension's bridge announced itself on this page. Listen early;
 * resolves true if a `ready`/`saved` message arrives within `timeoutMs`.
 */
export function detectExtension(timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as { source?: string } | undefined;
      if (data?.source === 'meeting-copilot-ext') {
        cleanup();
        resolve(true);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve(false);
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
    window.addEventListener('message', onMessage);
  });
}
