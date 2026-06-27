import { resolveAi, extractJson, type AiCredentials } from '../ai/provider.js';
import { HttpError } from '../middleware/errorHandler.js';
import type { BriefContext, BriefQA, MeetingBrief } from '../types/index.js';

const MAX_DOC_CHARS = 6000;
const MAX_TOTAL_DOC_CHARS = 24000;

/** Assemble a compact, token-bounded context string for the prompt. */
function buildContextText(ctx: BriefContext): string {
  const lines: string[] = [];
  lines.push(`Title: ${ctx.title}`);
  if (ctx.type) lines.push(`Type: ${ctx.type}`);
  if (ctx.scheduledAt) lines.push(`Scheduled: ${ctx.scheduledAt}`);
  if (ctx.durationMinutes) lines.push(`Duration: ${ctx.durationMinutes} min`);
  if (ctx.description) lines.push(`Description: ${ctx.description}`);

  if (ctx.participants.length) {
    lines.push(
      `Participants: ${ctx.participants
        .map((p) => (p.role ? `${p.name} (${p.role})` : p.name))
        .join(', ')}`,
    );
  }
  if (ctx.agenda.length) lines.push(`Agenda:\n- ${ctx.agenda.join('\n- ')}`);
  if (ctx.goals.length) lines.push(`Goals:\n- ${ctx.goals.join('\n- ')}`);
  if (ctx.notes.length) lines.push(`Notes:\n- ${ctx.notes.join('\n- ')}`);

  let budget = MAX_TOTAL_DOC_CHARS;
  for (const doc of ctx.documents) {
    if (budget <= 0) break;
    const slice = doc.text.slice(0, Math.min(MAX_DOC_CHARS, budget));
    budget -= slice.length;
    if (slice.trim()) {
      lines.push(`\n--- Document: ${doc.name} ---\n${slice}`);
    }
  }
  return lines.join('\n');
}

const SYSTEM_PROMPT = `You are an expert executive assistant who prepares concise, actionable meeting briefs.
Analyze the provided meeting context and supporting documents, then produce a brief.
Respond with ONLY a valid JSON object matching exactly this schema:
{
  "summary": string,                // 2-4 sentence overview of the meeting's purpose and context
  "keyTopics": string[],            // 3-7 short topic labels
  "questions": [                    // 3-6 anticipated questions and how to answer them
    { "question": string, "response": string }
  ],
  "importantFacts": string[],       // 3-7 key facts/figures pulled from the context & documents
  "actionItems": string[]           // 3-7 concrete next steps or preparation tasks
}
Do not include any commentary outside the JSON.`;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((v) => String(v).trim()).filter(Boolean)
    : [];

const asQaArray = (value: unknown): BriefQA[] =>
  Array.isArray(value)
    ? value
        .map((item) => ({
          question: String((item as BriefQA)?.question ?? '').trim(),
          response: String((item as BriefQA)?.response ?? '').trim(),
        }))
        .filter((qa) => qa.question || qa.response)
    : [];

/**
 * Generate a structured meeting brief using the OpenAI API.
 * @throws HttpError(503) when no API key is configured.
 */
export async function generateBrief(
  ctx: BriefContext,
  creds: AiCredentials,
): Promise<MeetingBrief> {
  if (!ctx.title?.trim()) {
    throw new HttpError(400, 'Meeting context must include a title.');
  }

  const { client, model, config } = resolveAi(creds);
  const contextText = buildContextText(ctx);

  let completion;
  try {
    completion = await client.chat.completions.create({
      model,
      temperature: 0.4,
      // Only request strict JSON mode where the provider supports it.
      ...(config.jsonMode
        ? { response_format: { type: 'json_object' as const } }
        : {}),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Generate the meeting brief from this context:\n\n${contextText}`,
        },
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI request failed.';
    throw new HttpError(502, `AI generation failed: ${message}`);
  }

  const raw = completion.choices[0]?.message?.content ?? '{}';
  const parsed = extractJson(raw);

  return {
    summary: String(parsed.summary ?? '').trim(),
    keyTopics: asStringArray(parsed.keyTopics),
    questions: asQaArray(parsed.questions),
    importantFacts: asStringArray(parsed.importantFacts),
    actionItems: asStringArray(parsed.actionItems),
    generatedAt: Date.now(),
    source: 'openai',
    model,
  };
}
