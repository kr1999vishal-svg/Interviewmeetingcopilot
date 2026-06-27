export const config = {
  apiUrl: import.meta.env.VITE_API_URL ?? 'http://localhost:4000',
  wsUrl: import.meta.env.VITE_WS_URL ?? 'ws://localhost:4000/ws',
} as const;
