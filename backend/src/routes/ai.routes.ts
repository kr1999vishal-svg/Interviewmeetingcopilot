import { Router } from 'express';
import { listProviders, testAi } from '../controllers/ai.controller.js';

export const aiRouter = Router();

aiRouter.get('/providers', listProviders);
aiRouter.post('/test', testAi);
