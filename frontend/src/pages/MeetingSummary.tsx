import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Sparkles,
  CheckSquare,
  Square,
  ListChecks,
  FileText,
  ArrowLeft,
  RefreshCw,
  AlertTriangle,
  CalendarClock,
  FileDown,
  FileType2,
  Copy,
  Check,
} from 'lucide-react';
import { storage } from '@/lib/storage';
import { api, ApiError } from '@/lib/api';
import { createId } from '@/lib/format';
import {
  exportSummaryPdf,
  exportSummaryDocx,
  copySummary,
} from '@/lib/exportSummary';
import { ErrorBanner, PageHeader, Spinner } from '@/components/ui';
import type { ActionItem, Meeting, MeetingSummary as Summary } from '@/types';

/** Local summary generator used as a fallback when the server is unreachable. */
function localSummary(meeting: Meeting): Summary {
  const lines = [
    ...meeting.transcript.map((t) => t.text),
    ...meeting.notes.split('\n'),
  ]
    .map((l) => l.trim())
    .filter(Boolean);

  const decisions = lines.filter((l) =>
    /\b(decide|decided|agree|agreed|conclusion|will)\b/i.test(l),
  );
  const actionItems: ActionItem[] = lines
    .filter((l) => /\b(todo|action|follow up|assign|owner|next step)\b/i.test(l))
    .map((text) => ({ id: createId(), text, done: false }));

  const risks = lines.filter((l) =>
    /\b(risk|concern|blocker|issue|problem|challenge|delay|depend)\b/i.test(l),
  );

  const followUps = lines.filter((l) =>
    /\b(follow up|follow-up|circle back|revisit|next meeting|later|schedule)\b/i.test(l),
  );

  return {
    overview:
      lines.length > 0
        ? `Discussed "${meeting.title}" with ${meeting.participants.length} participant(s). Captured ${meeting.transcript.length} transcript entries.`
        : `No live transcript was recorded for "${meeting.title}".`,
    decisions: decisions.slice(0, 10),
    actionItems: actionItems.slice(0, 20),
    risks: risks.slice(0, 10),
    followUps: followUps.slice(0, 10),
    generatedAt: Date.now(),
    source: 'local',
  };
}

export default function MeetingSummary() {
  const { id } = useParams<{ id: string }>();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<null | 'pdf' | 'docx'>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const found = id ? storage.getMeeting(id) : undefined;
    if (!found) {
      setError('Meeting not found.');
      setLoading(false);
      return;
    }
    setMeeting(found);
    setLoading(false);
    if (!found.summary) void generate(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const persist = (next: Meeting) => {
    storage.saveMeeting(next);
    setMeeting({ ...next });
  };

  const generate = async (target: Meeting) => {
    setGenerating(true);
    setError(null);
    const settings = storage.getSettings();
    try {
      let summary: Summary;
      if (settings.syncToServer) {
        // Sync local state to the server, then ask it to summarize.
        await api.syncMeeting(target);
        const result = await api.summarize(target.id);
        summary = result.summary ?? localSummary(target);
      } else {
        summary = localSummary(target);
      }
      persist({ ...target, summary, status: 'completed' });
    } catch (err) {
      // Graceful fallback: generate locally and surface a soft warning.
      const message =
        err instanceof ApiError
          ? `${err.message} — generated a local summary instead.`
          : 'Generated a local summary (server unavailable).';
      setError(message);
      persist({
        ...target,
        summary: localSummary(target),
        status: 'completed',
      });
    } finally {
      setGenerating(false);
    }
  };

  const toggleAction = (actionId: string) => {
    if (!meeting?.summary) return;
    const summary: Summary = {
      ...meeting.summary,
      actionItems: meeting.summary.actionItems.map((a) =>
        a.id === actionId ? { ...a, done: !a.done } : a,
      ),
    };
    persist({ ...meeting, summary });
  };

  const handleExportPdf = () => {
    if (!meeting) return;
    setExporting('pdf');
    try {
      exportSummaryPdf(meeting);
    } catch {
      setError('Could not generate the PDF.');
    } finally {
      setExporting(null);
    }
  };

  const handleExportDocx = async () => {
    if (!meeting) return;
    setExporting('docx');
    try {
      await exportSummaryDocx(meeting);
    } catch {
      setError('Could not generate the DOCX.');
    } finally {
      setExporting(null);
    }
  };

  const handleCopy = async () => {
    if (!meeting) return;
    const ok = await copySummary(meeting);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setError('Clipboard copy was blocked by the browser.');
    }
  };

  if (loading) return <Spinner label="Loading summary..." />;
  if (!meeting)
    return (
      <div className="space-y-4">
        <ErrorBanner message={error ?? 'Meeting not found.'} />
        <Link to="/" className="btn-secondary">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
      </div>
    );

  const summary = meeting.summary;

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Meeting Summary"
        subtitle={meeting.title}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="btn-secondary"
              onClick={handleExportPdf}
              disabled={!summary || exporting !== null}
            >
              <FileDown className="h-4 w-4" /> PDF
            </button>
            <button
              className="btn-secondary"
              onClick={handleExportDocx}
              disabled={!summary || exporting !== null}
            >
              <FileType2 className="h-4 w-4" />
              {exporting === 'docx' ? 'Exporting…' : 'DOCX'}
            </button>
            <button
              className="btn-secondary"
              onClick={handleCopy}
              disabled={!summary}
            >
              {copied ? (
                <>
                  <Check className="h-4 w-4 text-emerald-300" /> Copied
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" /> Copy
                </>
              )}
            </button>
            <button
              className="btn-secondary"
              onClick={() => generate(meeting)}
              disabled={generating}
            >
              <RefreshCw className={`h-4 w-4 ${generating ? 'animate-spin' : ''}`} />
              Regenerate
            </button>
          </div>
        }
      />

      {error && (
        <div className="mb-4">
          <ErrorBanner message={error} />
        </div>
      )}

      {generating && !summary ? (
        <Spinner label="Generating summary..." />
      ) : summary ? (
        <div className="space-y-6">
          <section className="card p-5">
            <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-300">
              <Sparkles className="h-4 w-4 text-brand-300" /> Overview
            </h3>
            <p className="text-sm leading-relaxed text-slate-200">
              {summary.overview}
            </p>
          </section>

          <section className="card p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
              <ListChecks className="h-4 w-4 text-emerald-300" /> Decisions
            </h3>
            {summary.decisions.length === 0 ? (
              <p className="text-sm text-slate-500">No decisions detected.</p>
            ) : (
              <ul className="space-y-2">
                {summary.decisions.map((d, i) => (
                  <li
                    key={i}
                    className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-slate-200"
                  >
                    {d}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
              <CheckSquare className="h-4 w-4 text-amber-300" /> Action Items
            </h3>
            {summary.actionItems.length === 0 ? (
              <p className="text-sm text-slate-500">No action items detected.</p>
            ) : (
              <ul className="space-y-1">
                {summary.actionItems.map((a) => (
                  <li key={a.id}>
                    <button
                      onClick={() => toggleAction(a.id)}
                      className="flex w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-muted"
                    >
                      {a.done ? (
                        <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                      ) : (
                        <Square className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                      )}
                      <span
                        className={
                          a.done ? 'text-slate-500 line-through' : 'text-slate-200'
                        }
                      >
                        {a.text}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
              <AlertTriangle className="h-4 w-4 text-red-300" /> Risks
            </h3>
            {summary.risks.length === 0 ? (
              <p className="text-sm text-slate-500">No risks identified.</p>
            ) : (
              <ul className="space-y-2">
                {summary.risks.map((r, i) => (
                  <li
                    key={i}
                    className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-slate-200"
                  >
                    {r}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
              <CalendarClock className="h-4 w-4 text-sky-300" /> Follow-ups
            </h3>
            {summary.followUps.length === 0 ? (
              <p className="text-sm text-slate-500">No follow-ups recorded.</p>
            ) : (
              <ul className="space-y-2">
                {summary.followUps.map((f, i) => (
                  <li
                    key={i}
                    className="rounded-lg bg-surface-muted px-3 py-2 text-sm text-slate-200"
                  >
                    {f}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {meeting.transcript.length > 0 && (
            <section className="card p-5">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-300">
                <FileText className="h-4 w-4 text-slate-400" /> Full Transcript
              </h3>
              <div className="max-h-64 space-y-2 overflow-y-auto">
                {meeting.transcript.map((t) => (
                  <p key={t.id} className="text-sm text-slate-300">
                    <span className="font-semibold text-brand-300">
                      {t.speaker}:
                    </span>{' '}
                    {t.text}
                  </p>
                ))}
              </div>
            </section>
          )}
        </div>
      ) : (
        <ErrorBanner
          message="No summary available yet."
          onRetry={() => generate(meeting)}
        />
      )}
    </div>
  );
}
