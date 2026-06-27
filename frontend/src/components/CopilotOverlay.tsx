import { useCallback, useEffect, useRef, useState } from 'react';
import {
  GripVertical,
  Minimize2,
  Maximize2,
  X,
  MessageSquare,
  Reply,
  Lightbulb,
} from 'lucide-react';
import type { TranscriptEntry } from '@/types';

/**
 * Floating, always-on-top copilot overlay.
 *
 * Features: draggable (header), resizable (expanded), adjustable opacity,
 * compact/expand modes. Position, size, opacity and mode persist to
 * localStorage so the overlay reopens where the user left it.
 */

type Mode = 'compact' | 'expanded';

interface OverlayState {
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  mode: Mode;
}

const STORAGE_KEY = 'mc.overlay';

const COMPACT_WIDTH = 300;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 220;

const defaultState = (): OverlayState => ({
  x: Math.max(16, window.innerWidth - 380),
  y: 96,
  width: 340,
  height: 440,
  opacity: 1,
  mode: 'expanded',
});

function loadState(): OverlayState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...defaultState(), ...(JSON.parse(raw) as OverlayState) };
  } catch {
    /* ignore */
  }
  return defaultState();
}

function saveState(state: OverlayState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

interface CopilotOverlayProps {
  latestTranscript?: TranscriptEntry;
  suggestedResponse?: string;
  importantFacts: string[];
  onClose: () => void;
}

export default function CopilotOverlay({
  latestTranscript,
  suggestedResponse,
  importantFacts,
  onClose,
}: CopilotOverlayProps) {
  const [state, setState] = useState<OverlayState>(loadState);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Persist (debounced via rAF-free simple effect on settle).
  useEffect(() => {
    saveState(state);
  }, [state]);

  // Keep the overlay on-screen if the window is resized.
  useEffect(() => {
    const onResize = () =>
      setState((s) => ({
        ...s,
        x: clamp(s.x, 0, Math.max(0, window.innerWidth - 80)),
        y: clamp(s.y, 0, Math.max(0, window.innerHeight - 60)),
      }));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* ---- Dragging ---- */
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  const onDragMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const width =
      stateRef.current.mode === 'compact' ? COMPACT_WIDTH : stateRef.current.width;
    setState((s) => ({
      ...s,
      x: clamp(e.clientX - d.dx, 0, window.innerWidth - width),
      y: clamp(e.clientY - d.dy, 0, window.innerHeight - 48),
    }));
  }, []);

  const endDrag = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', endDrag);
  }, [onDragMove]);

  const startDrag = (e: React.PointerEvent) => {
    // Ignore drags that start on interactive controls.
    if ((e.target as HTMLElement).closest('button, input')) return;
    dragRef.current = { dx: e.clientX - state.x, dy: e.clientY - state.y };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', endDrag);
  };

  /* ---- Resizing ---- */
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  const onResizeMove = useCallback((e: PointerEvent) => {
    const r = resizeRef.current;
    if (!r) return;
    setState((s) => ({
      ...s,
      width: clamp(
        r.startW + (e.clientX - r.startX),
        MIN_WIDTH,
        window.innerWidth - s.x,
      ),
      height: clamp(
        r.startH + (e.clientY - r.startY),
        MIN_HEIGHT,
        window.innerHeight - s.y,
      ),
    }));
  }, []);

  const endResize = useCallback(() => {
    resizeRef.current = null;
    window.removeEventListener('pointermove', onResizeMove);
    window.removeEventListener('pointerup', endResize);
  }, [onResizeMove]);

  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startW: state.width,
      startH: state.height,
    };
    window.addEventListener('pointermove', onResizeMove);
    window.addEventListener('pointerup', endResize);
  };

  // Clean up any in-flight listeners on unmount.
  useEffect(() => endDrag, [endDrag]);
  useEffect(() => endResize, [endResize]);

  const compact = state.mode === 'compact';
  const toggleMode = () =>
    setState((s) => ({ ...s, mode: s.mode === 'compact' ? 'expanded' : 'compact' }));

  return (
    <div
      className="fixed z-50 flex flex-col overflow-hidden rounded-xl border border-brand-500/30 bg-surface shadow-2xl shadow-black/50 ring-1 ring-black/20"
      style={{
        left: state.x,
        top: state.y,
        width: compact ? COMPACT_WIDTH : state.width,
        height: compact ? undefined : state.height,
        opacity: state.opacity,
      }}
    >
      {/* Header / drag handle */}
      <div
        onPointerDown={startDrag}
        className="flex cursor-grab items-center gap-2 border-b border-surface-border bg-surface-muted/60 px-2 py-1.5 active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4 shrink-0 text-slate-500" />
        <span className="flex-1 select-none text-xs font-semibold text-slate-200">
          Copilot
        </span>

        {/* Opacity control */}
        <input
          type="range"
          min={0.3}
          max={1}
          step={0.05}
          value={state.opacity}
          onChange={(e) =>
            setState((s) => ({ ...s, opacity: Number(e.target.value) }))
          }
          title="Opacity"
          className="h-1 w-16 cursor-pointer accent-brand-500"
        />

        <button
          onClick={toggleMode}
          title={compact ? 'Expand' : 'Compact'}
          className="rounded p-1 text-slate-400 hover:bg-surface-border hover:text-slate-200"
        >
          {compact ? (
            <Maximize2 className="h-3.5 w-3.5" />
          ) : (
            <Minimize2 className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          onClick={onClose}
          title="Close overlay"
          className="rounded p-1 text-slate-400 hover:bg-red-500/20 hover:text-red-300"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {/* Suggested response — primary in both modes */}
        <Section icon={<Reply className="h-3.5 w-3.5 text-emerald-300" />} title="Suggested Response">
          {suggestedResponse ? (
            <p className="text-sm text-slate-200">{suggestedResponse}</p>
          ) : (
            <p className="text-xs text-slate-500">Listening for suggestions…</p>
          )}
        </Section>

        {!compact && (
          <>
            <Section
              icon={<MessageSquare className="h-3.5 w-3.5 text-brand-300" />}
              title="Latest Transcript"
            >
              {latestTranscript ? (
                <p className="text-sm text-slate-300">
                  <span className="font-medium text-brand-300">
                    {latestTranscript.speaker}:
                  </span>{' '}
                  {latestTranscript.text}
                </p>
              ) : (
                <p className="text-xs text-slate-500">No transcript yet.</p>
              )}
            </Section>

            <Section
              icon={<Lightbulb className="h-3.5 w-3.5 text-amber-300" />}
              title="Important Facts"
            >
              {importantFacts.length > 0 ? (
                <ul className="space-y-1">
                  {importantFacts.slice(0, 5).map((fact, i) => (
                    <li key={i} className="flex gap-2 text-sm text-slate-300">
                      <span className="text-slate-500">•</span>
                      <span>{fact}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500">
                  No facts yet. Generate a meeting brief to populate this.
                </p>
              )}
            </Section>
          </>
        )}
      </div>

      {/* Resize handle (expanded only) */}
      {!compact && (
        <div
          onPointerDown={startResize}
          className="absolute bottom-0 right-0 h-4 w-4 cursor-nwse-resize"
          title="Resize"
        >
          <svg viewBox="0 0 10 10" className="h-full w-full text-slate-600">
            <path d="M9 1 L9 9 L1 9" stroke="currentColor" strokeWidth="1" fill="none" />
          </svg>
        </div>
      )}
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-muted/40 p-2.5">
      <h4 className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {icon} {title}
      </h4>
      {children}
    </div>
  );
}
