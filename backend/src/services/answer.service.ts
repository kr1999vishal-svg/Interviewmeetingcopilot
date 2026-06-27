import { resolveAi, type AiCredentials } from '../ai/provider.js';
import { HttpError } from '../middleware/errorHandler.js';

const MAX_CONTEXT_CHARS = 6000;
const MAX_TRANSCRIPT_CHARS = 4000;

export interface AnswerRequest {
  /** The question (usually asked by another participant) to answer. */
  question: string;
  /** Optional meeting title for grounding. */
  title?: string;
  /** Optional brief / background context to ground the answer. */
  context?: string;
  /** Recent transcript so the answer fits the live conversation. */
  transcript?: string;
}

export interface AnswerResult {
  answer: string;
  model: string;
  provider: string;
}

const SYSTEM_PROMPT = `You are a real-time meeting copilot speaking on behalf of the user.
A question has just been asked in the meeting. Using the meeting context and recent conversation, write a concise, confident, natural-sounding answer the user can say or paste into the chat.
Rules:
- 1-3 short sentences, under 60 words total.
- Plain text only (no markdown, no preamble like "You could say").
- If the context lacks the answer, give a reasonable, professional response and offer to follow up.`;

function buildPrompt(req: AnswerRequest): string {
  const lines: string[] = [];
  if (req.title) lines.push(`Meeting: ${req.title}`);
  if (req.context?.trim()) {
    lines.push(`\nBackground:\n${req.context.slice(0, MAX_CONTEXT_CHARS)}`);
  }
  if (req.transcript?.trim()) {
    lines.push(
      `\nRecent conversation:\n${req.transcript.slice(-MAX_TRANSCRIPT_CHARS)}`,
    );
  }
  lines.push(`\nQuestion to answer:\n${req.question.trim()}`);
  return lines.join('\n');
}

/**
 * Generate a concise answer to a single asked question.
 * @throws HttpError(503) when no API key is configured.
 */
export async function generateAnswer(
  req: AnswerRequest,
  creds: AiCredentials,
): Promise<AnswerResult> {
  if (!req.question?.trim()) {
    throw new HttpError(400, 'A question is required.');
  }

  const { client, model, provider } = resolveAi(creds);

  const completion = await client.chat.completions.create({
    model,
    temperature: 0.5,
    max_tokens: 200,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildPrompt(req) },
    ],
  });

  const answer = completion.choices[0]?.message?.content?.trim() ?? '';
  if (!answer) throw new HttpError(502, 'AI returned an empty answer.');

  return { answer, model, provider };
}
