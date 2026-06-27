import type { Request, Response } from 'express';
import { PROVIDERS, resolveAi, type AiCredentials } from '../ai/provider.js';

/** List the supported providers and their default models for the UI. */
export const listProviders = (_req: Request, res: Response): void => {
  res.json(
    Object.entries(PROVIDERS).map(([id, cfg]) => ({
      id,
      label: cfg.label,
      defaultModel: cfg.defaultModel,
    })),
  );
};

/**
 * Validate a provider credential with a tiny live request. Returns a friendly
 * `{ ok, message }` (HTTP 200 either way) so the Settings UI can render inline
 * status. The supplied key is used only for this call and never stored.
 */
export const testAi = async (req: Request, res: Response): Promise<void> => {
  const creds = req.body as AiCredentials;
  if (!creds?.apiKey?.trim()) {
    res.json({ ok: false, message: 'Enter an API key to test.' });
    return;
  }

  try {
    const { client, model } = resolveAi(creds);
    // Validate the key with a lightweight `models.list` call instead of a
    // completion, so we don't consume the provider's generation quota.
    await client.models.list();
    res.json({ ok: true, message: `Key is valid (default model: ${model}).`, model });
  } catch (err) {
    const status = (err as { status?: number })?.status;
    // Surface the provider's own error detail when available — it explains the
    // real cause (e.g., quota exhausted vs. per-minute rate limit).
    const detail =
      (err as { error?: { message?: string } })?.error?.message ||
      (err instanceof Error ? err.message : '');
    const detailSuffix = detail ? ` — ${detail}` : '';

    let message =
      err instanceof Error ? err.message : 'Connection test failed.';
    if (status === 401) message = `Invalid or revoked API key (401)${detailSuffix}`;
    else if (status === 404)
      message = `Model or endpoint not found (404). Check the model name${detailSuffix}`;
    else if (status === 429)
      message = `Rate limit or quota reached (429). Your key has no available quota or is being throttled${detailSuffix}`;
    res.json({ ok: false, message });
  }
};
