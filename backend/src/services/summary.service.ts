import { resolveAi, extractJson, type AiCredentials } from '../ai/provider.js';
import { HttpError } from '../middleware/errorHandler.js';
import { createId } from '../utils/id.js';
import type { ActionItem, Meeting, MeetingSummary } from '../types/index.js';

const MAX_TRANSCRIPT_CHARS = 24000;

const SYSTEM_PROMPT = `You are an expert meeting note-taker. Given a meeting's transcript and notes, produce a post-meeting summary.
Respond with ONLY a valid JSON object matching exactly this schema:
{
  "overview": string,        // 2-4 sentence recap of what the meeting covered and concluded
  "decisions": string[],     // concrete decisions that were made
  "actionItems": string[],   // concrete tasks/next steps, ideally with an owner if mentioned
  "risks": string[],         // risks, blockers, concerns, or open issues raised
  "followUps": string[]      // items to revisit, follow-up topics, or things deferred to later
}
Use [] for any section with no relevant content. Do not include commentary outside the JSON.`;

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((v) => String(v).trim()).filter(Boolean)
    : [];

function buildContextText(meeting: Meeting): string {
  const transcript = meeting.transcript
    .map((t) => `${t.speaker}: ${t.text}`)
    .join('\n')
    .slice(-MAX_TRANSCRIPT_CHARS);

  const parts = [`Title: ${meeting.title}`];
  if (meeting.description) parts.push(`Description: ${meeting.description}`);
  if (meeting.agenda?.length) parts.push(`Agenda:\n- ${meeting.agenda.join('\n- ')}`);
  if (meeting.notes?.trim()) parts.push(`Notes:\n${meeting.notes.trim()}`);
  parts.push(`Transcript:\n${transcript || '(no transcript captured)'}`);
  return parts.join('\n\n');
}

/**
 * Generate a structured post-meeting summary using the OpenAI API.
 * @throws HttpError(503) when no API key is configured.
 */
export async function generateAiSummary(
  meeting: Meeting,
  creds: AiCredentials,
): Promise<MeetingSummary> {
  const { client, model, config } = resolveAi(creds);

  let completion;
  try {
    completion = await client.chat.completions.create({
      model,
      temperature: 0.3,
      ...(config.jsonMode
        ? { response_format: { type: 'json_object' as const } }
        : {}),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Summarize this meeting:\n\n${buildContextText(meeting)}`,
        },
      ],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'AI request failed.';
    throw new HttpError(502, `AI summary failed: ${message}`);
  }

  const raw = completion.choices[0]?.message?.content ?? '{}';
  const parsed = extractJson(raw);

  const actionItems: ActionItem[] = asStringArray(parsed.actionItems).map(
    (text) => ({ id: createId(), text, done: false }),
  );

  return {
    overview: String(parsed.overview ?? '').trim(),
    decisions: asStringArray(parsed.decisions),
    actionItems,
    risks: asStringArray(parsed.risks),
    followUps: asStringArray(parsed.followUps),
    generatedAt: Date.now(),
    source: 'openai',
    model,
  };
}
