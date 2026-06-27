import { createServer } from 'node:http';

const port = process.env.PORT ? Number(process.env.PORT) : 4000;

async function main() {
  const { createApp } = await import('./app.js');
  const { attachWebSocket } = await import('./ws/socket.js');

  const app = createApp();
  const server = createServer(app);

  attachWebSocket(server);

  server.listen(port, '0.0.0.0', () => {
    console.log(`[meeting-copilot] API ready at http://0.0.0.0:${port}`);
    console.log(`[meeting-copilot] WebSocket listening on /ws`);
  });

  const shutdown = (signal: string) => {
    console.log(`\n[meeting-copilot] received ${signal}, shutting down...`);
    server.close(() => process.exit(0));
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[meeting-copilot] Failed to start:', err);
  process.exit(1);
});
