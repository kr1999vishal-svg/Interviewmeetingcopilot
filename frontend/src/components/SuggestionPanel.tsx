import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Reply,
  Megaphone,
  HelpCircle,
  ListChecks,
  RefreshCw,
  Loader2,
  Cpu,
  Play,
  Pause,
  AlertCircle,
  Database,
} from 'lucide-react';
import {
  buildSuggestionContext,
  streamSuggestions,
  parseSuggestions,
  isEmptySuggestions,
  localSuggestions,
  SuggestionStreamError,
} from '@/lib/suggestionEngine';
import { ensureIndexed, retrieve } from '@/lib/retrieval';
import { formatTime } from '@/lib/format';
import type { TokenUsage } from '@/lib/suggestionEngine';
import type { Meeting, RetrievedChunk, Suggestions, TranscriptEntry } from '@/types';

const REFRESH_MS = 8000;

const EMPTY: Suggestions = {
  responses: [],
  talkingPoints: [],
  questions: [],
  followups: [],
};

interface SuggestionPanelProps {
  meeting: Meeting;
  transcript: TranscriptEntry[];
  /** Reports token usage for each completed AI request. */
  onUsage?: (usage: TokenUsage) => void;
  /** Reports the current suggestions (e.g. for the floating overlay). */
  onSuggestions?: (suggestions: Suggestions) => void;
}

export default function SuggestionPanel({
  meeting,
  transcript,
  onUsage,
  onSuggestions,
}: SuggestionPanelProps) {
  const [suggestions, setSuggestions] = useState<Suggestions>(EMPTY);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<'ai' | 'local' | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [chunkCount, setChunkCount] = useState(0);
  const [matchCount, setMatchCount] = useState<number | null>(null);

  // Refs keep the interval callback reading current values without re-binding.
  const meetingRef = useRef(meeting);
  meetingRef.current = meeting;
  const transcriptRef = useRef(transcript);
  transcriptRef.current = transcript;
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;

  const abortRef = useRef<AbortController | null>(null);
  const lastSigRef = useRef('');
  const aiDisabledRef = useRef(false);
  const chunkCountRef = useRef(0);
  chunkCountRef.current = chunkCount;

  const refresh = useCallback(async (force = false) => {
    const m = meetingRef.current;
    const t = transcriptRef.current;
    if (!m) return;

    // Skip when nothing has changed since the last run.
    const sig = `${t.length}:${t[t.length - 1]?.text ?? ''}`;
    if (!force && sig === lastSigRef.current) return;
    lastSigRef.current = sig;

    // No API key available: serve local suggestions without a network call.
    if (aiDisabledRef.current) {
      setSuggestions(localSuggestions(m, t));
      setSource('local');
      setLastUpdated(Date.now());
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStreaming(true);
    setError(null);

    // Similarity search: embed the most recent transcript and pull the most
    // relevant document chunks to inject into the prompt.
    let retrieved: RetrievedChunk[] = [];
    if (chunkCountRef.current > 0) {
      const query = t.slice(-6).map((e) => e.text).join(' ');
      try {
        retrieved = await retrieve(m.id, query, 4);
      } catch {
        retrieved = [];
      }
      setMatchCount(retrieved.length);
    }

    try {
      await streamSuggestions(
        buildSuggestionContext(m, t, retrieved),
        {
          onUpdate: (text) => setSuggestions(parseSuggestions(text)),
          onUsage: (usage) => onUsage?.(usage),
          onDone: (text) => {
            const parsed = parseSuggestions(text);
            if (!isEmptySuggestions(parsed)) setSuggestions(parsed);
            setSource('ai');
            setLastUpdated(Date.now());
          },
        },
        controller.signal,
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      // Fall back to local suggestions on any failure.
      setSuggestions(localSuggestions(m, t));
      setSource('local');
      setLastUpdated(Date.now());
      if (err instanceof SuggestionStreamError && err.status === 503) {
        aiDisabledRef.current = true; // stop hammering a key-less server
      } else {
        setError(err instanceof Error ? err.message : 'Suggestion error.');
      }
    } finally {
      if (abortRef.current === controller) {
        setStreaming(false);
        abortRef.current = null;
      }
    }
  }, []);

  // Index the meeting's documents (chunk + embed) once on mount, then populate.
  useEffect(() => {
    let active = true;
    (async () => {
      setIndexing(true);
      try {
        const result = await ensureIndexed(meetingRef.current);
        if (active) setChunkCount(result.chunkCount);
      } catch {
        /* retrieval is best-effort; suggestions still work without it */
      } finally {
        if (active) setIndexing(false);
      }
      if (active) void refresh(true);
    })();
    return () => {
      active = false;
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Surface current suggestions to interested parents (e.g. overlay).
  useEffect(() => {
    onSuggestions?.(suggestions);
  }, [suggestions, onSuggestions]);

  // Periodic auto-refresh.
  useEffect(() => {
    if (!autoRefresh) return;
    const id = setInterval(() => {
      if (!streamingRef.current) void refresh(false);
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [autoRefresh, refresh]);

  return (
    <div className="card p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
          <Sparkles className="h-4 w-4 text-brand-300" /> AI Suggestions
          {streaming && <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-300" />}
        </h3>
        <div className="flex items-center gap-2">
          {source && (
            <span className="badge bg-surface-muted text-slate-400">
              <Cpu className="h-3 w-3" />
              {source === 'ai' ? 'AI · streaming' : 'Local'}
            </span>
          )}
          {(indexing || chunkCount > 0) && (
            <span className="badge bg-surface-muted text-slate-400" title="Document retrieval (RAG)">
              <Database className="h-3 w-3" />
              {indexing
                ? 'Indexing…'
                : matchCount !== null
                  ? `${matchCount}/${chunkCount} chunks`
                  : `${chunkCount} chunks`}
            </span>
          )}
          <button
            className="btn-ghost px-2 py-1.5 text-xs"
            onClick={() => setAutoRefresh((v) => !v)}
            title={autoRefresh ? 'Pause auto-refresh' : 'Resume auto-refresh'}
          >
            {autoRefresh ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {autoRefresh ? 'Auto' : 'Paused'}
          </button>
          <button
            className="btn-secondary px-2 py-1.5 text-xs"
            onClick={() => refresh(true)}
            disabled={streaming}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${streaming ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Section
          icon={<Reply className="h-4 w-4 text-emerald-300" />}
          title="Suggested Responses"
          items={suggestions.responses}
          streaming={streaming}
        />
        <Section
          icon={<Megaphone className="h-4 w-4 text-brand-300" />}
          title="Talking Points"
          items={suggestions.talkingPoints}
          streaming={streaming}
        />
        <Section
          icon={<HelpCircle className="h-4 w-4 text-sky-300" />}
          title="Clarifying Questions"
          items={suggestions.questions}
          streaming={streaming}
        />
        <Section
          icon={<ListChecks className="h-4 w-4 text-violet-300" />}
          title="Follow-up Ideas"
          items={suggestions.followups}
          streaming={streaming}
        />
      </div>

      {lastUpdated && (
        <p className="mt-4 text-right text-xs text-slate-500">
          Updated {formatTime(lastUpdated)}
        </p>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  items,
  streaming,
}: {
  icon: React.ReactNode;
  title: string;
  items: string[];
  streaming: boolean;
}) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-muted/40 p-3">
      <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
        {icon} {title}
      </h4>
      {items.length === 0 ? (
        <p className="text-xs text-slate-500">
          {streaming ? 'Thinking…' : 'No suggestions yet.'}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {items.map((item, i) => (
            <li key={i} className="flex gap-2 text-sm text-slate-200">
              <span className="text-slate-500">•</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
