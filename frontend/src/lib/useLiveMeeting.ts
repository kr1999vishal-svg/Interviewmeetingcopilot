import { useCallback, useEffect, useRef, useState } from 'react';
import { config } from '@/config/env';
import { createId } from '@/lib/format';
import type { ClientMessage, ServerMessage, TranscriptEntry } from '@/types';

export type ConnectionStatus = 'connecting' | 'open' | 'closed' | 'error';

interface UseLiveMeetingResult {
  status: ConnectionStatus;
  clients: number;
  transcript: TranscriptEntry[];
  remoteNotes: string | null;
  error: string | null;
  sendTranscript: (speaker: string, text: string) => void;
  appendLocal: (speaker: string, text: string) => void;
  sendNote: (notes: string) => void;
}

/**
 * Manages a WebSocket connection to the live-meeting room, with automatic
 * reconnection and clean teardown.
 */
export function useLiveMeeting(
  meetingId: string | undefined,
  initialTranscript: TranscriptEntry[] = [],
): UseLiveMeetingResult {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [clients, setClients] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>(initialTranscript);
  const [remoteNotes, setRemoteNotes] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUser = useRef(false);

  const send = useCallback((msg: ClientMessage) => {
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    if (!meetingId) return;
    closedByUser.current = false;

    const connect = () => {
      setStatus('connecting');
      const socket = new WebSocket(config.wsUrl);
      socketRef.current = socket;

      socket.onopen = () => {
        setStatus('open');
        setError(null);
        send({ type: 'join', meetingId });
      };

      socket.onmessage = (event) => {
        // Binary frames are relayed audio chunks (Blob/ArrayBuffer), not
        // control messages — ignore them here so JSON parsing doesn't fail.
        if (typeof event.data !== 'string') return;
        try {
          const msg = JSON.parse(event.data) as ServerMessage;
          switch (msg.type) {
            case 'joined':
              setClients(msg.clients);
              break;
            case 'presence':
              setClients(msg.clients);
              break;
            case 'transcript':
              setTranscript((prev) =>
                prev.some((t) => t.id === msg.entry.id)
                  ? prev
                  : [...prev, msg.entry],
              );
              break;
            case 'note':
              setRemoteNotes(msg.notes);
              break;
            case 'error':
              setError(msg.message);
              break;
          }
        } catch {
          setError('Received malformed message from server');
        }
      };

      socket.onerror = () => setStatus('error');

      socket.onclose = () => {
        setStatus('closed');
        if (!closedByUser.current) {
          reconnectRef.current = setTimeout(connect, 2000);
        }
      };
    };

    connect();

    return () => {
      closedByUser.current = true;
      if (reconnectRef.current) clearTimeout(reconnectRef.current);
      const socket = socketRef.current;
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'leave', meetingId }));
        socket.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingId]);

  const sendTranscript = useCallback(
    (speaker: string, text: string) => {
      if (!meetingId || !text.trim()) return;
      send({ type: 'transcript', meetingId, speaker, text: text.trim() });
    },
    [meetingId, send],
  );

  const appendLocal = useCallback((speaker: string, text: string) => {
    if (!text.trim()) return;
    setTranscript((prev) => [
      ...prev,
      { id: createId(), speaker, text: text.trim(), timestamp: Date.now() },
    ]);
  }, []);

  const sendNote = useCallback(
    (notes: string) => {
      if (!meetingId) return;
      send({ type: 'note', meetingId, notes });
    },
    [meetingId, send],
  );

  return {
    status,
    clients,
    transcript,
    remoteNotes,
    error,
    sendTranscript,
    appendLocal,
    sendNote,
  };
}
