import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  Send,
  StopCircle,
  Users,
  Wifi,
  WifiOff,
  ArrowLeft,
  MessageSquare,
  Mic,
  MicOff,
  Loader2,
  AlertCircle,
  FileText,
  Sparkles,
  Coins,
  Hash,
  Headphones,
  Bot,
} from 'lucide-react';
import { storage } from '@/lib/storage';
import { api } from '@/lib/api';
import { pushActiveMeetingToExtension } from '@/lib/extensionBridge';
import { useLiveMeeting } from '@/lib/useLiveMeeting';
import {
  TranscriptService,
  type TranscriptStatus,
} from '@/lib/transcriptService';
import type { TokenUsage } from '@/lib/suggestionEngine';
import type { CaptureStatus } from '@/lib/audioCapture';
import AudioCapturePanel from '@/components/AudioCapturePanel';
import SuggestionPanel from '@/components/SuggestionPanel';
import CopilotOverlay from '@/components/CopilotOverlay';
import { ErrorBanner, Spinner } from '@/components/ui';
import { formatTime } from '@/lib/format';
import type { Meeting, Suggestions } from '@/types';

export default function LiveMeeting() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const settings = storage.getSettings();
  const [speaker] = useState(settings.displayName || 'You');
  const [message, setMessage] = useState('');
  const [notes, setNotes] = useState('');

  // Status-bar metrics.
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>('idle');
  const [tokenUsage, setTokenUsage] = useState<TokenUsage>({
    prompt: 0,
    completion: 0,
    total: 0,
  });

  const handleUsage = useCallback((usage: TokenUsage) => {
    setTokenUsage((prev) => ({
      prompt: prev.prompt + usage.prompt,
      completion: prev.completion + usage.completion,
      total: prev.total + usage.total,
    }));
  }, []);

  // Floating copilot overlay.
  const [latestSuggestions, setLatestSuggestions] = useState<Suggestions | null>(
    null,
  );
  const [showOverlay, setShowOverlay] = useState<boolean>(() => {
    try {
      return localStorage.getItem('mc.overlay.visible') === 'true';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('mc.overlay.visible', String(showOverlay));
    } catch {
      /* ignore */
    }
  }, [showOverlay]);
  const handleSuggestions = useCallback((s: Suggestions) => {
    setLatestSuggestions(s);
  }, []);

  const {
    status,
    clients,
    transcript,
    remoteNotes,
    error,
    sendTranscript,
    appendLocal,
    sendNote,
  } = useLiveMeeting(meeting?.id, meeting?.transcript ?? []);

  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // --- Speech-to-text (Web Speech API) ---
  const [transcribing, setTranscribing] = useState(false);
  const [partial, setPartial] = useState('');
  const [sttStatus, setSttStatus] = useState<TranscriptStatus>('idle');
  const [sttError, setSttError] = useState<string | null>(null);
  const sttSupported = TranscriptService.isSupported();

  const serviceRef = useRef<TranscriptService | null>(null);
  // Keep latest values available inside long-lived STT callbacks.
  const statusRef = useRef(status);
  statusRef.current = status;
  const speakerRef = useRef(speaker);
  speakerRef.current = speaker;

  // Stable ref so the long-lived STT callback always uses current senders.
  const commitFinal = useRef<(text: string) => void>(() => {});
  commitFinal.current = (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    // Broadcast + persist when connected; otherwise show locally right away.
    if (statusRef.current === 'open') {
      sendTranscript(speakerRef.current, clean);
    } else {
      appendLocal(speakerRef.current, clean);
    }
  };

  const toggleTranscription = () => {
    if (transcribing) {
      serviceRef.current?.stop();
      serviceRef.current = null;
      setTranscribing(false);
      setPartial('');
      return;
    }
    setSttError(null);
    const service = new TranscriptService({
      speaker,
      onPartial: (seg) => setPartial(seg.text),
      onFinal: (seg) => {
        setPartial('');
        commitFinal.current(seg.text);
      },
      onStatus: setSttStatus,
      onError: (msg) => {
        setSttError(msg);
        setTranscribing(false);
        setPartial('');
      },
    });
    serviceRef.current = service;
    service.start();
    setTranscribing(true);
  };

  // Tear down transcription on unmount.
  useEffect(() => {
    return () => serviceRef.current?.stop();
  }, []);

  // Auto-scroll when a live partial updates too.
  useEffect(() => {
    if (partial) transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [partial]);

  useEffect(() => {
    const found = id ? storage.getMeeting(id) : undefined;
    if (!found) {
      setLoadError('Meeting not found.');
    } else {
      setMeeting(found);
      setNotes(found.notes);
      // The backend keeps only a transient copy of meetings (no DB) and may not
      // know about this localStorage-only meeting. Upsert it so live transcript
      // and note messages don't fail with "Meeting not found".
      void api.syncMeeting(found).catch(() => {
        /* best-effort; live session still works locally */
      });
      // Tell the browser-extension overlay which meeting (link + context) is
      // active, so it only assists this meeting on Meet/Teams.
      pushActiveMeetingToExtension(found);
    }
    setLoading(false);
  }, [id]);

  // Keep transcript scrolled to the latest entry.
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  // Reflect remote note edits coming from other clients.
  useEffect(() => {
    if (remoteNotes !== null) setNotes(remoteNotes);
  }, [remoteNotes]);

  const handleSend = () => {
    if (!message.trim()) return;
    sendTranscript(speaker, message);
    setMessage('');
  };

  const handleNotesChange = (value: string) => {
    setNotes(value);
    sendNote(value);
  };

  const endMeeting = () => {
    if (!meeting) return;
    const updated: Meeting = {
      ...meeting,
      status: 'completed',
      transcript,
      notes,
      updatedAt: Date.now(),
    };
    storage.saveMeeting(updated);
    navigate(`/meetings/${meeting.id}/summary`);
  };

  if (loading) return <Spinner label="Joining meeting..." />;
  if (loadError || !meeting)
    return (
      <div className="space-y-4">
        <ErrorBanner message={loadError ?? 'Meeting not found.'} />
        <Link to="/" className="btn-secondary">
          <ArrowLeft className="h-4 w-4" /> Back to dashboard
        </Link>
      </div>
    );

  const listening = captureStatus === 'listening';

  return (
    <div className="flex min-h-[calc(100vh-7rem)] flex-col gap-4">
      {/* TOP: Meeting Controls */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-slate-100">
              {meeting.title}
            </h1>
            <p className="text-sm text-slate-500">Live meeting workspace</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ConnectionPill status={status} clients={clients} />
            {sttSupported && (
              <button
                onClick={toggleTranscription}
                className={transcribing ? 'btn-danger' : 'btn-secondary'}
              >
                {transcribing ? (
                  <>
                    <MicOff className="h-4 w-4" /> Stop STT
                  </>
                ) : (
                  <>
                    <Mic className="h-4 w-4" /> Transcribe
                  </>
                )}
              </button>
            )}
            <button
              className={showOverlay ? 'btn-primary' : 'btn-secondary'}
              onClick={() => setShowOverlay((v) => !v)}
              title="Toggle floating copilot overlay"
            >
              <Bot className="h-4 w-4" /> Overlay
            </button>
            <button className="btn-danger" onClick={endMeeting}>
              <StopCircle className="h-4 w-4" /> End
            </button>
          </div>
        </div>

        {error && <ErrorBanner message={error} />}

        <AudioCapturePanel
          meetingId={meeting.id}
          onStatusChange={setCaptureStatus}
        />
      </div>

      {/* MIDDLE: Transcript | AI Suggestions | Meeting Brief */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-12">
        {/* LEFT: Transcript */}
        <section className="card flex h-[68vh] flex-col xl:col-span-4">
          <div className="flex items-center justify-between gap-2 border-b border-surface-border px-5 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-slate-300">
              <MessageSquare className="h-4 w-4" /> Transcript
            </span>
            {sttSupported ? (
              transcribing && (
                <span className="flex items-center gap-1 text-xs text-emerald-300">
                  {sttStatus === 'reconnecting' ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" /> Reconnecting
                    </>
                  ) : (
                    <>
                      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                      Transcribing
                    </>
                  )}
                </span>
              )
            ) : (
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <AlertCircle className="h-3.5 w-3.5" /> STT unsupported
              </span>
            )}
          </div>
          {sttError && (
            <div className="flex items-center gap-2 border-b border-surface-border bg-red-500/10 px-5 py-2 text-xs text-red-300">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {sttError}
            </div>
          )}
          <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
            {transcript.length === 0 ? (
              <p className="py-12 text-center text-sm text-slate-500">
                No messages yet. Start listening or type below.
              </p>
            ) : (
              transcript.map((entry) => (
                <div key={entry.id} className="animate-fade-in">
                  <div className="mb-0.5 flex items-baseline gap-2">
                    <span className="text-sm font-semibold text-brand-300">
                      {entry.speaker}
                    </span>
                    <span className="text-xs text-slate-500">
                      {formatTime(entry.timestamp)}
                    </span>
                  </div>
                  <p className="text-sm text-slate-200">{entry.text}</p>
                </div>
              ))
            )}
            {partial && (
              <div className="animate-fade-in opacity-70">
                <div className="mb-0.5 flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-brand-300">
                    {speaker}
                  </span>
                  <span className="text-xs italic text-slate-500">live…</span>
                </div>
                <p className="text-sm italic text-slate-400">{partial}</p>
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>
          <div className="flex gap-2 border-t border-surface-border p-4">
            <input
              className="input"
              placeholder={`Speaking as ${speaker}...`}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={status !== 'open'}
            />
            <button
              className="btn-primary"
              onClick={handleSend}
              disabled={status !== 'open' || !message.trim()}
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </section>

        {/* CENTER: AI Suggestions */}
        <section className="h-[68vh] overflow-y-auto xl:col-span-5">
          <SuggestionPanel
            meeting={meeting}
            transcript={transcript}
            onUsage={handleUsage}
            onSuggestions={handleSuggestions}
          />
        </section>

        {/* RIGHT: Meeting Brief + Shared Notes */}
        <section className="flex h-[68vh] flex-col gap-4 overflow-y-auto xl:col-span-3">
          <MeetingBriefSummary meeting={meeting} />
          <div className="card flex min-h-[12rem] flex-1 flex-col">
            <div className="border-b border-surface-border px-5 py-3 text-sm font-semibold text-slate-300">
              Shared Notes
            </div>
            <textarea
              className="flex-1 resize-none bg-transparent px-5 py-4 text-sm text-slate-200 outline-none placeholder:text-slate-500"
              placeholder="Notes sync live and feed the summary."
              value={notes}
              onChange={(e) => handleNotesChange(e.target.value)}
            />
          </div>
        </section>
      </div>

      {/* BOTTOM: Status Bar */}
      <StatusBar
        status={status}
        clients={clients}
        listening={listening}
        transcribing={transcribing}
        transcriptCount={transcript.length}
        tokens={tokenUsage}
        estimatedTokens={estimateTokens(transcript, notes)}
      />

      {/* Always-visible floating copilot overlay */}
      {showOverlay && (
        <CopilotOverlay
          latestTranscript={transcript[transcript.length - 1]}
          suggestedResponse={latestSuggestions?.responses[0]}
          importantFacts={meeting.brief?.importantFacts ?? []}
          onClose={() => setShowOverlay(false)}
        />
      )}
    </div>
  );
}

function ConnectionPill({
  status,
  clients,
}: {
  status: string;
  clients: number;
}) {
  const open = status === 'open';
  return (
    <span
      className={`badge ${
        open ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'
      }`}
    >
      {open ? <Wifi className="h-3.5 w-3.5" /> : <WifiOff className="h-3.5 w-3.5" />}
      {open ? (
        <span className="flex items-center gap-1">
          <Users className="h-3.5 w-3.5" /> {clients}
        </span>
      ) : (
        status
      )}
    </span>
  );
}

/** Rough token estimate (~4 chars/token) used when the API reports none. */
function estimateTokens(
  transcript: { text: string }[],
  notes: string,
): number {
  const chars =
    transcript.reduce((sum, e) => sum + e.text.length, 0) + notes.length;
  return Math.ceil(chars / 4);
}

/* ---- Right column: Meeting Brief ---- */

function MeetingBriefSummary({ meeting }: { meeting: Meeting }) {
  const brief = meeting.brief;

  return (
    <div className="card flex flex-col">
      <div className="flex items-center justify-between border-b border-surface-border px-5 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold text-slate-300">
          <FileText className="h-4 w-4" /> Meeting Brief
        </span>
        <Link
          to={`/meetings/${meeting.id}/brief`}
          className="text-xs text-brand-300 hover:underline"
        >
          {brief ? 'Edit' : 'Generate'}
        </Link>
      </div>

      {!brief ? (
        <div className="px-5 py-8 text-center text-sm text-slate-500">
          <Sparkles className="mx-auto mb-2 h-5 w-5 text-slate-600" />
          No brief yet. Generate one from the pre-meeting context.
        </div>
      ) : (
        <div className="space-y-4 px-5 py-4 text-sm">
          {brief.summary && (
            <p className="leading-relaxed text-slate-300">{brief.summary}</p>
          )}

          {brief.keyTopics.length > 0 && (
            <BriefBlock title="Key Topics">
              <div className="flex flex-wrap gap-1.5">
                {brief.keyTopics.map((topic, i) => (
                  <span key={i} className="badge bg-surface-muted text-slate-300">
                    {topic}
                  </span>
                ))}
              </div>
            </BriefBlock>
          )}

          {brief.questions.length > 0 && (
            <BriefBlock title="Likely Questions">
              <ul className="space-y-2">
                {brief.questions.map((qa, i) => (
                  <li key={i}>
                    <p className="font-medium text-slate-200">{qa.question}</p>
                    {qa.response && (
                      <p className="mt-0.5 text-slate-400">{qa.response}</p>
                    )}
                  </li>
                ))}
              </ul>
            </BriefBlock>
          )}

          {brief.importantFacts.length > 0 && (
            <BriefBlock title="Important Facts">
              <ul className="space-y-1">
                {brief.importantFacts.map((fact, i) => (
                  <li key={i} className="flex gap-2 text-slate-300">
                    <span className="text-slate-500">•</span>
                    <span>{fact}</span>
                  </li>
                ))}
              </ul>
            </BriefBlock>
          )}

          {brief.actionItems.length > 0 && (
            <BriefBlock title="Action Items">
              <ul className="space-y-1">
                {brief.actionItems.map((item, i) => (
                  <li key={i} className="flex gap-2 text-slate-300">
                    <span className="text-slate-500">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </BriefBlock>
          )}
        </div>
      )}
    </div>
  );
}

function BriefBlock({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h4>
      {children}
    </div>
  );
}

/* ---- Bottom: Status Bar ---- */

function StatusBar({
  status,
  clients,
  listening,
  transcribing,
  transcriptCount,
  tokens,
  estimatedTokens,
}: {
  status: string;
  clients: number;
  listening: boolean;
  transcribing: boolean;
  transcriptCount: number;
  tokens: TokenUsage;
  estimatedTokens: number;
}) {
  const connected = status === 'open';
  const tokenLabel =
    tokens.total > 0
      ? `${tokens.total.toLocaleString()} tokens`
      : `~${estimatedTokens.toLocaleString()} tokens`;

  return (
    <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border border-surface-border bg-surface/90 px-5 py-3 text-xs backdrop-blur">
      {/* Connection status */}
      <StatusItem
        icon={
          connected ? (
            <Wifi className="h-3.5 w-3.5 text-emerald-400" />
          ) : (
            <WifiOff className="h-3.5 w-3.5 text-amber-400" />
          )
        }
        label="Connection"
        value={
          connected ? (
            <span className="text-emerald-300">
              Connected · {clients} {clients === 1 ? 'client' : 'clients'}
            </span>
          ) : (
            <span className="text-amber-300 capitalize">{status}</span>
          )
        }
      />

      {/* Listening status */}
      <StatusItem
        icon={
          listening ? (
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
          ) : (
            <Headphones className="h-3.5 w-3.5 text-slate-500" />
          )
        }
        label="Listening"
        value={
          <span className={listening ? 'text-emerald-300' : 'text-slate-400'}>
            {listening ? 'Capturing audio' : 'Idle'}
            {transcribing && ' · STT on'}
          </span>
        }
      />

      {/* Transcript count */}
      <StatusItem
        icon={<Hash className="h-3.5 w-3.5 text-slate-500" />}
        label="Transcript"
        value={<span className="text-slate-300">{transcriptCount} entries</span>}
      />

      {/* Token usage */}
      <StatusItem
        icon={<Coins className="h-3.5 w-3.5 text-slate-500" />}
        label="Token usage"
        value={<span className="text-slate-300">{tokenLabel}</span>}
      />
    </div>
  );
}

function StatusItem({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-slate-500">{label}:</span>
      {value}
    </div>
  );
}
