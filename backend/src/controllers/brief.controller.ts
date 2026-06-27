import type { NextFunction, Request, Response } from 'express';
import { generateBrief } from '../services/brief.service.js';
import { aiAvailable, type AiCredentials } from '../ai/provider.js';
import type { BriefContext } from '../types/index.js';

export const briefStatus = (_req: Request, res: Response): void => {
  res.json({ enabled: aiAvailable() });
};

export const createBrief = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const body = req.body as BriefContext & { ai?: AiCredentials };
    const brief = await generateBrief(body, body.ai ?? {});
    res.json(brief);
  } catch (err) {
    next(err);
  }
};
