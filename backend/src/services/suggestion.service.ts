import { resolveAi, type AiCredentials } from '../ai/provider.js';
import type { SuggestionContext } from '../types/index.js';

const MAX_DOC_CHARS = 3000;
const MAX_TOTAL_DOC_CHARS = 9000;
const MAX_TRANSCRIPT_CHARS = 6000;

/**
 * The model is asked to emit four clearly delimited sections in a fixed
 * order. The fixed markers let the client parse sections progressively as
 * tokens stream in.
 */
const SYSTEM_PROMPT = `You are a real-time meeting copilot. As the conversation unfolds, you help the user respond well and steer the meeting.
Using the meeting context, documents, and the latest transcript, produce concise, immediately useful suggestions.
Output PLAIN TEXT in EXACTLY these four sections, in this order, each starting with the marker on its own line, with 2-4 short bullet points (each prefixed by "- "):

[RESPONSES]
- suggested things the user could say right now

[TALKING_POINTS]
- key points worth raising given the context

[QUESTIONS]
- clarifying questions the user could ask

[FOLLOWUPS]
- follow-up ideas or next steps

Keep each bullet under 20 words. Do not add any text outside these sections.`;

function buildContextText(ctx: SuggestionContext): string {
  const lines: string[] = [];
  if (ctx.title) lines.push(`Meeting: ${ctx.title}`);
  if (ctx.brief) lines.push(`\nBrief:\n${ctx.brief}`);
  if (ctx.userContext.length) {
    lines.push(`\nUser context:\n- ${ctx.userContext.join('\n- ')}`);
  }

  // Prefer excerpts retrieved by similarity search (RAG). Fall back to raw
  // documents only when no retrieval results were supplied.
  if (ctx.retrievedContext?.length) {
    let budget = MAX_TOTAL_DOC_CHARS;
    lines.push('\nRelevant document excerpts (most relevant to the current discussion):');
    for (const excerpt of ctx.retrievedContext) {
      if (budget <= 0) break;
      const slice = excerpt.text.slice(0, Math.min(MAX_DOC_CHARS, budget));
      budget -= slice.length;
      if (slice.trim()) lines.push(`\n[${excerpt.source}]\n${slice}`);
    }
  } else {
    let budget = MAX_TOTAL_DOC_CHARS;
    for (const doc of ctx.documents) {
      if (budget <= 0) break;
      const slice = doc.text.slice(0, Math.min(MAX_DOC_CHARS, budget));
      budget -= slice.length;
      if (slice.trim()) lines.push(`\n--- Document: ${doc.name} ---\n${slice}`);
    }
  }

  if (ctx.previousTranscript?.trim()) {
    lines.push(
      `\nEarlier conversation:\n${ctx.previousTranscript.slice(-MAX_TRANSCRIPT_CHARS)}`,
    );
  }
  lines.push(
    `\nMost recent conversation:\n${ctx.currentTranscript.slice(-MAX_TRANSCRIPT_CHARS) || '(no speech yet)'}`,
  );
  return lines.join('\n');
}

export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

/**
 * Stream suggestion tokens from OpenAI, invoking `onToken` for each delta and
 * `onUsage` once token usage is reported at the end of the stream.
 * @throws HttpError(503) when no API key is configured.
 */
export async function streamSuggestions(
  ctx: SuggestionContext,
  creds: AiCredentials,
  onToken: (delta: string) => void,
  signal?: AbortSignal,
  onUsage?: (usage: TokenUsage) => void,
): Promise<void> {
  const { client, model, config } = resolveAi(creds);

  const stream = await client.chat.completions.create(
    {
      model,
      temperature: 0.6,
      stream: true,
      // Ask the provider to include token usage in the final streamed chunk
      // (only providers that support the option).
      ...(config.usageOption
        ? { stream_options: { include_usage: true } }
        : {}),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildContextText(ctx) },
      ],
    },
    { signal },
  );

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) onToken(delta);
    if (chunk.usage && onUsage) {
      onUsage({
        prompt: chunk.usage.prompt_tokens ?? 0,
        completion: chunk.usage.completion_tokens ?? 0,
        total: chunk.usage.total_tokens ?? 0,
      });
    }
  }
}
