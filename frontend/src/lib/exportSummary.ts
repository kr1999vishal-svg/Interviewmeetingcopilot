import { generatePdf, type PdfBlock } from '@/lib/pdf';
import { generateDocx, type DocxBlock } from '@/lib/docx';
import type { Meeting } from '@/types';

/**
 * Builds export representations (PDF, DOCX, plain text) of a meeting summary
 * from a single shared, structured document model.
 */

type Style = 'title' | 'subtitle' | 'h2' | 'normal' | 'bullet';

interface DocBlock {
  text: string;
  style: Style;
}

const formatDate = (ms: number): string =>
  new Date(ms).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

/** Assemble the structured document model from a meeting + its summary. */
function buildDocBlocks(meeting: Meeting): DocBlock[] {
  const blocks: DocBlock[] = [];
  const summary = meeting.summary;

  blocks.push({ text: meeting.title, style: 'title' });
  blocks.push({
    text: `Meeting Summary · ${formatDate(summary?.generatedAt ?? Date.now())}`,
    style: 'subtitle',
  });

  const section = (heading: string, items: string[], empty = 'None recorded.') => {
    blocks.push({ text: heading, style: 'h2' });
    if (items.length === 0) {
      blocks.push({ text: empty, style: 'normal' });
    } else {
      for (const item of items) blocks.push({ text: item, style: 'bullet' });
    }
  };

  // 1. Meeting Summary (overview)
  blocks.push({ text: 'Meeting Summary', style: 'h2' });
  blocks.push({
    text: summary?.overview || 'No summary available.',
    style: 'normal',
  });

  // 2-5. Decisions, Action Items, Risks, Follow-ups
  section('Decisions', summary?.decisions ?? []);
  section(
    'Action Items',
    (summary?.actionItems ?? []).map(
      (a) => `${a.done ? '[x] ' : '[ ] '}${a.text}`,
    ),
  );
  section('Risks', summary?.risks ?? []);
  section('Follow-ups', summary?.followUps ?? []);

  // 6. Full Transcript
  blocks.push({ text: 'Full Transcript', style: 'h2' });
  if (meeting.transcript.length === 0) {
    blocks.push({ text: 'No transcript was recorded.', style: 'normal' });
  } else {
    for (const entry of meeting.transcript) {
      blocks.push({ text: `${entry.speaker}: ${entry.text}`, style: 'normal' });
    }
  }

  return blocks;
}

/* ---- Converters ---- */

function toPdfBlocks(blocks: DocBlock[]): PdfBlock[] {
  return blocks.map((b) => {
    switch (b.style) {
      case 'title':
        return { text: b.text, bold: true, size: 20, gap: 6 };
      case 'subtitle':
        return { text: b.text, size: 10, gap: 12 };
      case 'h2':
        return { text: b.text, bold: true, size: 14, gap: 6 };
      case 'bullet':
        return { text: `- ${b.text}`, size: 11, gap: 2 };
      default:
        return { text: b.text, size: 11, gap: 4 };
    }
  });
}

function toDocxBlocks(blocks: DocBlock[]): DocxBlock[] {
  return blocks.map((b) => {
    switch (b.style) {
      case 'title':
        return { text: b.text, bold: true, size: 20 };
      case 'subtitle':
        return { text: b.text, size: 10 };
      case 'h2':
        return { text: b.text, bold: true, size: 14 };
      case 'bullet':
        return { text: `• ${b.text}`, size: 11 };
      default:
        return { text: b.text, size: 11 };
    }
  });
}

function toPlainText(blocks: DocBlock[]): string {
  const lines: string[] = [];
  for (const b of blocks) {
    switch (b.style) {
      case 'title':
        lines.push(b.text, '='.repeat(Math.min(b.text.length, 60)));
        break;
      case 'h2':
        lines.push('', b.text, '-'.repeat(Math.min(b.text.length, 60)));
        break;
      case 'bullet':
        lines.push(`- ${b.text}`);
        break;
      default:
        lines.push(b.text);
    }
  }
  return lines.join('\n');
}

/* ---- Helpers ---- */

const safeName = (meeting: Meeting): string =>
  (meeting.title || 'meeting')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 60) || 'meeting';

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after the click has been processed.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---- Public API ---- */

export function exportSummaryPdf(meeting: Meeting): void {
  const blob = generatePdf(toPdfBlocks(buildDocBlocks(meeting)));
  downloadBlob(blob, `${safeName(meeting)}-summary.pdf`);
}

export async function exportSummaryDocx(meeting: Meeting): Promise<void> {
  const blob = await generateDocx(toDocxBlocks(buildDocBlocks(meeting)));
  downloadBlob(blob, `${safeName(meeting)}-summary.docx`);
}

export function summaryToText(meeting: Meeting): string {
  return toPlainText(buildDocBlocks(meeting));
}

export async function copySummary(meeting: Meeting): Promise<boolean> {
  const text = summaryToText(meeting);
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
