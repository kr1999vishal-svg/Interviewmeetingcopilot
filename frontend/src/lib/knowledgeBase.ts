import type {
  KnowledgeBase,
  Meeting,
  SupportingDocument,
} from '@/types';
import { meetingTypeLabel } from '@/types';
import { formatDateTime } from '@/lib/format';

/**
 * Knowledge Base service.
 *
 * Combines three inputs — the context chat (notes/links/goals), uploaded
 * files (extracted text), and meeting metadata — into a single structured
 * object that can be stored as JSON and rendered in the UI.
 */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'her',
  'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how', 'man',
  'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did', 'its', 'let',
  'put', 'say', 'she', 'too', 'use', 'this', 'that', 'with', 'from', 'they',
  'will', 'have', 'what', 'when', 'your', 'there', 'their', 'about', 'would',
  'which', 'them', 'then', 'than', 'into', 'more', 'some', 'such', 'only',
  'also', 'been', 'were', 'over', 'most', 'must', 'should', 'could', 'these',
  'those', 'here', 'each', 'other', 'after', 'before', 'where', 'while',
  'meeting', 'meetings', 'discuss', 'discussion', 'team', 'slide', 'slides',
]);

const RISK_PATTERN =
  /\b(risk|risks|concern|concerns|blocker|blocked|blocking|issue|issues|problem|problems|delay|delayed|deadline|dependency|dependencies|depends|bottleneck|challenge|challenges|uncertain|unclear|missing|lack|behind schedule|over budget|at risk|critical|urgent)\b/i;

const GOAL_PATTERN =
  /\b(goal|goals|objective|achieve|deliver|decide|decision|align|finalize|finalise|approve|plan|target|outcome|aim)\b/i;

const unique = (items: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const item = raw.trim();
    const key = item.toLowerCase();
    if (item && !seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
};

const toSentences = (text: string): string[] =>
  text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

const extractKeyTopics = (text: string, max = 8): string[] => {
  const freq = new Map<string, number>();
  const words = text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [];
  for (const word of words) {
    if (STOPWORDS.has(word)) continue;
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }
  return [...freq.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([word]) => word);
};

const wordCount = (text: string): number =>
  text.split(/\s+/).filter(Boolean).length;

function buildSummary(
  meeting: Meeting,
  goals: string[],
  risks: string[],
  docCount: number,
): string {
  const typeLabel = meetingTypeLabel(meeting.type ?? 'other');
  const parts: string[] = [];

  parts.push(
    `${typeLabel} meeting "${meeting.title}" is scheduled for ${formatDateTime(
      meeting.scheduledAt,
    )} (${meeting.durationMinutes} min) with ${
      meeting.participants.length
    } participant(s).`,
  );

  if (meeting.description?.trim()) {
    parts.push(meeting.description.trim());
  }

  if (goals.length > 0) {
    parts.push(
      `Primary objective(s): ${goals.slice(0, 3).join('; ')}${
        goals.length > 3 ? '; …' : '.'
      }`,
    );
  }

  if (docCount > 0) {
    parts.push(
      `${docCount} supporting document(s) were attached and analyzed for context.`,
    );
  }

  if (risks.length > 0) {
    parts.push(`${risks.length} potential risk(s) flagged for attention.`);
  }

  return parts.join(' ');
}

export function generateKnowledgeBase(meeting: Meeting): KnowledgeBase {
  const context = meeting.context ?? [];
  const attachments = meeting.attachments ?? [];

  const notes = context
    .filter((c) => c.type === 'note')
    .map((c) => c.content);
  const contextGoals = context
    .filter((c) => c.type === 'goal')
    .map((c) => c.content);

  const docText = attachments
    .map((a) => a.extractedText ?? '')
    .filter(Boolean)
    .join('\n');

  const allText = [
    meeting.description ?? '',
    ...meeting.agenda,
    ...notes,
    docText,
  ].join('\n');

  // Goals: explicit goal chat items + agenda/notes lines that read like goals.
  const inferredGoals = [...meeting.agenda, ...notes].filter((line) =>
    GOAL_PATTERN.test(line),
  );
  const goals = unique([...contextGoals, ...inferredGoals]).slice(0, 12);

  // Risks: sentences across notes + documents that match risk language.
  const risks = unique(
    toSentences([notes.join('\n'), docText].join('\n')).filter((s) =>
      RISK_PATTERN.test(s),
    ),
  ).slice(0, 10);

  // Talking points: agenda items + notes, de-duplicated.
  const talkingPoints = unique([...meeting.agenda, ...notes]).slice(0, 15);

  const keyTopics = extractKeyTopics(allText);

  const supportingDocuments: SupportingDocument[] = attachments.map((a) => {
    const text = (a.extractedText ?? '').trim();
    return {
      id: a.id,
      name: a.name,
      type: a.extension,
      excerpt: text.slice(0, 280),
      wordCount: wordCount(text),
    };
  });

  return {
    meetingSummary: buildSummary(meeting, goals, risks, attachments.length),
    participants: meeting.participants.map((p) => ({
      name: p.name,
      role: p.role,
    })),
    goals,
    risks,
    talkingPoints,
    keyTopics,
    supportingDocuments,
    generatedAt: Date.now(),
  };
}
