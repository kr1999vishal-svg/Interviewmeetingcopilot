import { useEffect, useRef, useState } from 'react';
import {
  Mic,
  MonitorSpeaker,
  Radio,
  Square,
  AlertCircle,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { config } from '@/config/env';
import { AudioCapture, type AudioSource, type CaptureStatus } from '@/lib/audioCapture';
import { formatFileSize } from '@/lib/format';

const SOURCE_OPTIONS: { value: AudioSource; label: string; icon: typeof Mic }[] = [
  { value: 'microphone', label: 'Microphone', icon: Mic },
  { value: 'tab', label: 'Tab audio', icon: MonitorSpeaker },
  { value: 'both', label: 'Mic + Tab', icon: Radio },
];

interface AudioCapturePanelProps {
  meetingId: string;
  /** Notifies the parent whenever the capture status changes. */
  onStatusChange?: (status: CaptureStatus) => void;
}

export default function AudioCapturePanel({
  meetingId,
  onStatusChange,
}: AudioCapturePanelProps) {
  const [source, setSource] = useState<AudioSource>('microphone');
  const [status, setStatus] = useState<CaptureStatus>('idle');
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [bytesSent, setBytesSent] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);

  const captureRef = useRef<AudioCapture | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  // Tear everything down if the component unmounts mid-capture.
  useEffect(() => {
    return () => {
      captureRef.current?.stop();
      socketRef.current?.close();
    };
  }, []);

  // Bubble capture status to the parent (for the status bar).
  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  const teardownSocket = () => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'audio-stop', meetingId }));
      socket.close();
    }
    socketRef.current = null;
    setWsConnected(false);
  };

  const stop = () => {
    captureRef.current?.stop();
    captureRef.current = null;
    teardownSocket();
  };

  const start = () => {
    setError(null);
    setBytesSent(0);

    const socket = new WebSocket(config.wsUrl);
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;

    const capture = new AudioCapture({
      source,
      timeSliceMs: 1000,
      onStatus: setStatus,
      onLevel: setLevel,
      onError: (message) => {
        setError(message);
        teardownSocket();
      },
      onChunk: (chunk) => {
        const ws = socketRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(chunk); // binary frame
          setBytesSent((b) => b + chunk.size);
        }
      },
    });
    captureRef.current = capture;

    socket.onopen = () => {
      setWsConnected(true);
      socket.send(
        JSON.stringify({
          type: 'audio-start',
          meetingId,
          mimeType: capture.getMimeType(),
        }),
      );
      void capture.start();
    };
    socket.onclose = () => setWsConnected(false);
    socket.onerror = () => {
      setError('Audio streaming connection failed.');
      capture.stop();
    };
  };

  const listening = status === 'listening';
  const busy = status === 'requesting';

  return (
    <div className="card mb-6 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-300">
          <Radio className="h-4 w-4 text-brand-300" /> Audio Capture
        </h3>
        <StatusPill status={status} wsConnected={wsConnected} />
      </div>

      {/* Source selector */}
      <div className="mb-4 flex flex-wrap gap-2">
        {SOURCE_OPTIONS.map((opt) => {
          const active = source === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              disabled={listening || busy}
              onClick={() => setSource(opt.value)}
              className={`btn px-3 py-1.5 text-xs ${
                active
                  ? 'bg-brand-600 text-white'
                  : 'bg-surface-muted text-slate-300 hover:bg-surface-border'
              }`}
            >
              <opt.icon className="h-3.5 w-3.5" /> {opt.label}
            </button>
          );
        })}
      </div>

      {/* Level meter */}
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between text-xs text-slate-500">
          <span>Input level</span>
          <span>{Math.round(level * 100)}%</span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-surface-border">
          <div
            className={`h-full rounded-full transition-[width] duration-75 ${
              level > 0.8
                ? 'bg-red-500'
                : level > 0.5
                  ? 'bg-amber-400'
                  : 'bg-emerald-500'
            }`}
            style={{ width: `${Math.round(level * 100)}%` }}
          />
        </div>
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        {listening || busy ? (
          <button className="btn-danger" onClick={stop}>
            <Square className="h-4 w-4" /> Stop Listening
          </button>
        ) : (
          <button className="btn-primary" onClick={start}>
            <Mic className="h-4 w-4" /> Start Listening
          </button>
        )}
        <span className="text-xs text-slate-500">
          {bytesSent > 0 ? `${formatFileSize(bytesSent)} streamed` : 'Not streaming'}
        </span>
      </div>
    </div>
  );
}

function StatusPill({
  status,
  wsConnected,
}: {
  status: CaptureStatus;
  wsConnected: boolean;
}) {
  if (status === 'listening') {
    return (
      <span className="badge bg-emerald-500/15 text-emerald-300">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
        Listening
        {wsConnected ? (
          <Wifi className="h-3 w-3" />
        ) : (
          <WifiOff className="h-3 w-3" />
        )}
      </span>
    );
  }
  if (status === 'requesting') {
    return (
      <span className="badge bg-amber-500/15 text-amber-300">Requesting…</span>
    );
  }
  if (status === 'error') {
    return <span className="badge bg-red-500/15 text-red-300">Error</span>;
  }
  return <span className="badge bg-surface-muted text-slate-400">Idle</span>;
}
