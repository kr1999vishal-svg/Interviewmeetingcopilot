import type { NextFunction, Request, Response } from 'express';
import { generateAnswer, type AnswerRequest } from '../services/answer.service.js';
import type { AiCredentials } from '../ai/provider.js';
import { getFileContext, formatFileContextForAI } from '../services/fileProcessor.service.js';

interface AnswerBody extends AnswerRequest {
  ai?: AiCredentials;
  fileIds?: string[];
}

export const answerQuestion = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const body = (req.body ?? {}) as AnswerBody;
    const creds: AiCredentials = body.ai ?? {};
    
    // Process attached files for context
    let enhancedContext = body.context || '';
    if (body.fileIds && body.fileIds.length > 0) {
      const fileContexts = await getFileContext(body.fileIds);
      const fileContextText = formatFileContextForAI(fileContexts);
      enhancedContext += fileContextText;
    }
    
    const result = await generateAnswer(
      {
        question: body.question,
        title: body.title,
        context: enhancedContext,
        transcript: body.transcript,
      },
      creds,
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
};
