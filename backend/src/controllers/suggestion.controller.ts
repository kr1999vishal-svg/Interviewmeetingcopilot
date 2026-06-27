import type { Request, Response } from 'express';
import { streamSuggestions } from '../services/suggestion.service.js';
import { aiAvailable, type AiCredentials } from '../ai/provider.js';
import { HttpError } from '../middleware/errorHandler.js';
import type { SuggestionContext } from '../types/index.js';

type SuggestionBody = SuggestionContext & { ai?: AiCredentials };

export const suggestionStatus = (_req: Request, res: Response): void => {
  // AI is "available" if the server has a fallback key; clients may also
  // supply their own key per request, so the client UI gates on its settings.
  res.json({ enabled: aiAvailable() });
};

/**
 * Streams suggestions to the client using Server-Sent Events. Each token is
 * sent as a `data:` event; a final `done` event closes the stream.
 */
export const streamSuggestionsController = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const body = req.body as SuggestionBody;
  const creds: AiCredentials = body.ai ?? {};

  // If AI is unavailable, fail before opening the stream so the client can
  // fall back to local suggestions.
  if (!aiAvailable(creds)) {
    res.status(503).json({
      error:
        'No AI API key configured. Add a provider key in Settings to enable live suggestions.',
    });
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();

  const controller = new AbortController();
  // Stop the upstream OpenAI request if the client disconnects.
  req.on('close', () => controller.abort());

  try {
    await streamSuggestions(
      body as SuggestionContext,
      creds,
      (delta) => {
        res.write(`data: ${JSON.stringify({ delta })}\n\n`);
      },
      controller.signal,
      (usage) => {
        res.write(`event: usage\ndata: ${JSON.stringify(usage)}\n\n`);
      },
    );
    res.write('event: done\ndata: {}\n\n');
  } catch (err) {
    if (controller.signal.aborted) {
      res.end();
      return;
    }
    const message =
      err instanceof HttpError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Suggestion generation failed.';
    res.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
  } finally {
    res.end();
  }
};
