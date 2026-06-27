import { Router } from 'express';
import { answerQuestion } from '../controllers/answer.controller.js';

export const answerRouter = Router();

answerRouter.post('/', answerQuestion);
