import { Router } from 'express';
import { briefStatus, createBrief } from '../controllers/brief.controller.js';

export const briefRouter = Router();

briefRouter.get('/status', briefStatus);
briefRouter.post('/', createBrief);
