import type { NextFunction, Request, Response } from 'express';
import { meetingService } from '../services/meeting.service.js';
import { generateAiSummary } from '../services/summary.service.js';
import { aiAvailable, type AiCredentials } from '../ai/provider.js';

export const listMeetings = (
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  try {
    res.json(meetingService.list());
  } catch (err) {
    next(err);
  }
};

export const getMeeting = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  try {
    res.json(meetingService.get(req.params.id));
  } catch (err) {
    next(err);
  }
};

export const createMeeting = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  try {
    res.status(201).json(meetingService.create(req.body));
  } catch (err) {
    next(err);
  }
};

export const updateMeeting = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  try {
    res.json(meetingService.update(req.params.id, req.body));
  } catch (err) {
    next(err);
  }
};

export const syncMeeting = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  try {
    res.json(meetingService.sync(req.body));
  } catch (err) {
    next(err);
  }
};

export const deleteMeeting = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  try {
    meetingService.remove(req.params.id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
};

export const summarizeMeeting = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const id = req.params.id;
    const creds: AiCredentials =
      (req.body as { ai?: AiCredentials } | undefined)?.ai ?? {};
    // Prefer an AI-generated summary; fall back to the deterministic heuristic
    // if no key is configured or the AI request fails.
    if (aiAvailable(creds)) {
      try {
        const meeting = meetingService.get(id);
        const summary = await generateAiSummary(meeting, creds);
        res.json(meetingService.update(id, { summary, status: 'completed' }));
        return;
      } catch {
        /* fall through to heuristic */
      }
    }
    res.json(meetingService.generateSummary(id));
  } catch (err) {
    next(err);
  }
};
