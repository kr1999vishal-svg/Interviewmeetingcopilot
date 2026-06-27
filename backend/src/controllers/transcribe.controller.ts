import type { NextFunction, Request, Response } from 'express';
import { transcribeAudio } from '../services/transcribe.service.js';
import type { AiCredentials, AiProvider } from '../ai/provider.js';

/**
 * Accepts a raw audio segment (body parsed by express.raw) plus AI credentials
 * supplied via headers, and returns the transcribed text.
 */
export const transcribe = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const creds: AiCredentials = {
      provider: (req.header('x-ai-provider') as AiProvider) || undefined,
      apiKey: req.header('x-ai-key') || undefined,
    };
    const sttModel = req.header('x-stt-model') || undefined;
    const mimeType = req.header('content-type') || 'audio/webm';
    const audio = req.body as Buffer;

    const result = await transcribeAudio(audio, mimeType, creds, sttModel);
    res.json(result);
  } catch (err) {
    next(err);
  }
};
