/**
 * OpenAI API key helpers.
 *
 * SECURITY: The key is stored only in the browser's localStorage and is sent
 * exclusively to api.openai.com. It is NEVER transmitted to this app's own
 * backend. The test request below talks directly to OpenAI from the browser.
 */

/** OpenAI keys look like `sk-...` or `sk-proj-...` followed by a long token. */
const KEY_PATTERN = /^sk-(proj-)?[A-Za-z0-9_-]{20,}$/;

export const isValidOpenAiKey = (key: string): boolean =>
  KEY_PATTERN.test(key.trim());

/** Mask a key for display, e.g. `sk-proj-ab…wXyz`. */
export const maskKey = (key: string): string => {
  const trimmed = key.trim();
  if (trimmed.length <= 11) return '•'.repeat(trimmed.length);
  return `${trimmed.slice(0, 7)}…${trimmed.slice(-4)}`;
};

export interface KeyTestResult {
  ok: boolean;
  message: string;
}

/**
 * Verify the key by calling OpenAI directly. Returns a friendly result rather
 * than throwing, so the UI can render an inline status.
 */
export async function testOpenAiKey(key: string): Promise<KeyTestResult> {
  const trimmed = key.trim();
  if (!isValidOpenAiKey(trimmed)) {
    return { ok: false, message: 'Key format looks invalid.' };
  }

  let res: Response;
  try {
    res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${trimmed}` },
    });
  } catch {
    return {
      ok: false,
      message: 'Could not reach OpenAI. Check your network connection.',
    };
  }

  if (res.ok) {
    return { ok: true, message: 'Key is valid and active.' };
  }
  if (res.status === 401) {
    return { ok: false, message: 'Invalid or revoked API key (401).' };
  }
  if (res.status === 429) {
    return {
      ok: false,
      message: 'Key reached its rate limit or quota (429).',
    };
  }
  return { ok: false, message: `OpenAI returned an error (${res.status}).` };
}
