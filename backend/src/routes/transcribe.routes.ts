import express, { Router } from 'express';
import { transcribe } from '../controllers/transcribe.controller.js';

export const transcribeRouter = Router();

// Parse any content type as a raw Buffer (audio/webm, audio/ogg, etc.).
transcribeRouter.post(
  '/',
  express.raw({ type: () => true, limit: '25mb' }),
  transcribe,
);
