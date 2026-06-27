import type { Server } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { env } from '../config/env.js';
import { meetingService } from '../services/meeting.service.js';
import { createId } from '../utils/id.js';
import type { ClientMessage, ServerMessage } from '../types/index.js';

interface LiveSocket extends WebSocket {
  meetingId?: string;
  isAlive?: boolean;
  recording?: boolean;
  audioBytes?: number;
}

/** Tracks how many sockets are connected to each meeting room. */
const rooms = new Map<string, Set<LiveSocket>>();

const join = (socket: LiveSocket, meetingId: string): number => {
  socket.meetingId = meetingId;
  if (!rooms.has(meetingId)) rooms.set(meetingId, new Set());
  rooms.get(meetingId)!.add(socket);
  return rooms.get(meetingId)!.size;
};

const leave = (socket: LiveSocket): void => {
  const { meetingId } = socket;
  if (!meetingId) return;
  const room = rooms.get(meetingId);
  if (!room) return;
  room.delete(socket);
  if (room.size === 0) rooms.delete(meetingId);
  else broadcast(meetingId, { type: 'presence', clients: room.size });
};

const broadcast = (
  meetingId: string,
  message: ServerMessage,
  except?: LiveSocket,
): void => {
  const room = rooms.get(meetingId);
  if (!room) return;
  const payload = JSON.stringify(message);
  for (const client of room) {
    if (client !== except && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
};

const send = (socket: LiveSocket, message: ServerMessage): void => {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
};

/** Relay raw audio bytes to the other participants in the room. */
const broadcastAudio = (
  meetingId: string,
  data: Buffer,
  except: LiveSocket,
): void => {
  const room = rooms.get(meetingId);
  if (!room) return;
  for (const client of room) {
    if (client !== except && client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: true });
    }
  }
};

export const attachWebSocket = (server: Server): WebSocketServer => {
  const wss = new WebSocketServer({ server, path: env.wsPath });

  wss.on('connection', (socket: LiveSocket) => {
    socket.isAlive = true;
    socket.on('pong', () => {
      socket.isAlive = true;
    });

    socket.on('message', (raw, isBinary) => {
      // Binary frames are streamed audio chunks; relay them and ack the size.
      if (isBinary) {
        const data = raw as Buffer;
        socket.audioBytes = (socket.audioBytes ?? 0) + data.byteLength;
        if (socket.meetingId) broadcastAudio(socket.meetingId, data, socket);
        send(socket, { type: 'audio-ack', bytes: socket.audioBytes });
        return;
      }

      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        send(socket, { type: 'error', message: 'Invalid JSON payload' });
        return;
      }

      try {
        switch (msg.type) {
          case 'join': {
            const clients = join(socket, msg.meetingId);
            send(socket, { type: 'joined', meetingId: msg.meetingId, clients });
            broadcast(msg.meetingId, { type: 'presence', clients }, socket);
            break;
          }
          case 'transcript': {
            const entry = {
              id: createId(),
              speaker: msg.speaker,
              text: msg.text,
              timestamp: Date.now(),
            };
            meetingService.appendTranscript(msg.meetingId, entry);
            broadcast(msg.meetingId, { type: 'transcript', entry });
            break;
          }
          case 'note': {
            meetingService.setNotes(msg.meetingId, msg.notes);
            broadcast(msg.meetingId, { type: 'note', notes: msg.notes }, socket);
            break;
          }
          case 'audio-start': {
            // Ensure the socket is in the room so chunks can be relayed.
            if (socket.meetingId !== msg.meetingId) join(socket, msg.meetingId);
            socket.recording = true;
            socket.audioBytes = 0;
            broadcast(
              msg.meetingId,
              { type: 'audio-status', recording: true, mimeType: msg.mimeType },
              socket,
            );
            break;
          }
          case 'audio-stop': {
            socket.recording = false;
            broadcast(
              msg.meetingId,
              { type: 'audio-status', recording: false },
              socket,
            );
            break;
          }
          case 'leave': {
            leave(socket);
            break;
          }
          default:
            send(socket, { type: 'error', message: 'Unknown message type' });
        }
      } catch (err) {
        send(socket, {
          type: 'error',
          message: err instanceof Error ? err.message : 'Server error',
        });
      }
    });

    socket.on('close', () => leave(socket));
    socket.on('error', () => leave(socket));
  });

  // Heartbeat to clean up dead connections.
  const interval = setInterval(() => {
    wss.clients.forEach((client) => {
      const socket = client as LiveSocket;
      if (socket.isAlive === false) {
        leave(socket);
        return socket.terminate();
      }
      socket.isAlive = false;
      socket.ping();
    });
  }, 30_000);

  wss.on('close', () => clearInterval(interval));

  return wss;
};
