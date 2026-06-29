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
        return callback(null, false);
      },
    }),
  );
  app.use(express.json({ limit: '12mb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.get('/debug/env', (_req, res) => {
    res.json({
      hasSupabaseUrl: !!process.env.SUPABASE_URL,
      hasSupabaseKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      supabaseUrlPrefix: process.env.SUPABASE_URL?.substring(0, 20) + '...',
      nodeEnv: process.env.NODE_ENV
    });
  });

  app.get('/debug/supabase', async (_req, res) => {
    const { supabase } = await import('./lib/supabase.js');
    try {
      const { data, error } = await supabase.from('admin_config').select('*').limit(1);
      res.json({ success: !error, error: error?.message, code: error?.code, data });
    } catch (err) {
      res.json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
  });

  app.post('/debug/supabase-save', async (req, res) => {
    const { supabase } = await import('./lib/supabase.js');
    try {
      const testConfig = {
        backend_url: 'https://test-render-url.onrender.com',
        ai_provider: 'openai',
        api_key: 'test-key',
        model: 'gpt-4',
        stt_provider: 'openai',
        stt_api_key: 'test-stt-key',
        stt_model: 'whisper-1'
      };
      const { data, error } = await supabase.from('admin_config').upsert(testConfig).select().single();
      res.json({ success: !error, error: error?.message, code: error?.code, data });
    } catch (err) {
      res.json({ success: false, error: err instanceof Error ? err.message : String(err) });
    }
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
