import type { BriefContextPayload } from '@/lib/api';
import { meetingTypeLabel } from '@/types';
import type { BriefQA, Meeting, MeetingBrief } from '@/types';
import { formatDateTime } from '@/lib/format';

/** Build the stateless payload sent to the AI brief endpoint. */
export function buildBriefContext(meeting: Meeting): BriefContextPayload {
  const context = meeting.context ?? [];
  return {
    title: meeting.title,
    type: meetingTypeLabel(meeting.type ?? 'other'),
    description: meeting.description,
    durationMinutes: meeting.durationMinutes,
    scheduledAt: meeting.scheduledAt,
    participants: meeting.participants.map((p) => ({
      name: p.name,
      role: p.role,
    })),
    agenda: meeting.agenda,
    notes: context.filter((c) => c.type === 'note').map((c) => c.content),
    goals: context.filter((c) => c.type === 'goal').map((c) => c.content),
    documents: (meeting.attachments ?? [])
      .filter((a) => a.extractedText?.trim())
      .map((a) => ({ name: a.name, text: a.extractedText ?? '' })),
  };
}

const ACTION_PATTERN =
  /\b(send|share|prepare|review|follow up|schedule|confirm|update|draft|create|assign|decide|finalize|finalise|present)\b/i;

const unique = (items: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const v = raw.trim();
    if (v && !seen.has(v.toLowerCase())) {
      seen.add(v.toLowerCase());
      out.push(v);
    }
  }
  return out;
};

/**
 * Local, non-AI fallback brief. Used when the OpenAI key is not configured
 * or the server is unreachable, so the feature still works offline.
 */
export function localBrief(meeting: Meeting): MeetingBrief {
  const kb = meeting.knowledgeBase;
  const context = meeting.context ?? [];
  const notes = context.filter((c) => c.type === 'note').map((c) => c.content);
  const goals =
    kb?.goals ?? context.filter((c) => c.type === 'goal').map((c) => c.content);
  const docs = meeting.attachments ?? [];

  const summary =
    kb?.meetingSummary ??
    `${meetingTypeLabel(meeting.type ?? 'other')} meeting "${meeting.title}" ` +
      `scheduled for ${formatDateTime(meeting.scheduledAt)} with ${
        meeting.participants.length
      } participant(s).`;

  const keyTopics = kb?.keyTopics ?? [];

  // Derive anticipated questions from agenda items and goals.
  const questions: BriefQA[] = unique([...meeting.agenda, ...goals])
    .slice(0, 5)
    .map((item) => ({
      question: `What do we need to align on regarding "${item}"?`,
      response: `Review the related context and documents, then confirm owners and next steps for "${item}".`,
    }));

  const importantFacts = unique([
    ...(meeting.description ? [meeting.description] : []),
    ...docs.map(
      (d) =>
        `${d.name}: ${(d.extractedText ?? '').slice(0, 140).trim() || 'no extractable text'}`,
    ),
    ...(kb?.risks ?? []).map((r) => `Risk: ${r}`),
  ]).slice(0, 7);

  const actionItems = unique([
    ...meeting.agenda.filter((a) => ACTION_PATTERN.test(a)),
    ...notes.filter((n) => ACTION_PATTERN.test(n)),
    ...goals.map((g) => `Prepare materials for: ${g}`),
  ]).slice(0, 7);

  return {
    summary,
    keyTopics,
    questions,
    importantFacts,
    actionItems,
    generatedAt: Date.now(),
    source: 'local',
  };
}
