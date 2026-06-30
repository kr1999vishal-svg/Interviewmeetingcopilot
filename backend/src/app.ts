import express from 'express';
import cors from 'cors';
import { env, isProduction } from './config/env.js';
import { meetingRouter } from './routes/meeting.routes.js';
import { briefRouter } from './routes/brief.routes.js';
import { suggestionRouter } from './routes/suggestion.routes.js';
import { aiRouter } from './routes/ai.routes.js';
import { answerRouter } from './routes/answer.routes.js';
import { transcribeRouter } from './routes/transcribe.routes.js';
import adminRouter from './routes/admin.routes.js';
import uploadRouter from './routes/upload.routes.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

export const createApp = () => {
  const app = express();

  // Allow the configured origins, plus any localhost/127.0.0.1 port during
  // development (Vite may fall back to 5174+ when 5173 is taken).
  const allowList = new Set(env.corsOrigins);
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true); // curl / same-origin
        if (allowList.has(origin)) return callback(null, true);
        if (
          !isProduction &&
          /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
        ) {
          return callback(null, true);
        }
        // The browser extension (offscreen/background) calls the backend.
        if (origin.startsWith('chrome-extension://') || origin.startsWith('moz-extension://')) {
          return callback(null, true);
        }
        // Allow Vercel admin webapp
        if (origin === 'https://interviewmeetingcopilot.vercel.app') {
          return callback(null, true);
        }
        return callback(null, false);
      },
    }),
  );
  app.use(express.json({ limit: '12mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.use('/api/meetings', meetingRouter);
  app.use('/api/brief', briefRouter);
  app.use('/api/suggestions', suggestionRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/answer', answerRouter);
  app.use('/api/transcribe', transcribeRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/upload', uploadRouter);

  app.use(notFound);
  app.use(errorHandler);

  return app;
};
