import { Router } from 'express';
import {
  suggestionStatus,
  streamSuggestionsController,
} from '../controllers/suggestion.controller.js';

export const suggestionRouter = Router();

suggestionRouter.get('/status', suggestionStatus);
suggestionRouter.post('/stream', streamSuggestionsController);
