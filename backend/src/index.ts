import { createServer } from 'node:http';
import { createApp } from './app.js';
import { attachWebSocket } from './ws/socket.js';
import { env } from './config/env.js';

const app = createApp();
const server = createServer(app);

attachWebSocket(server);

server.listen(env.port, env.host, () => {
  console.log(
    `[meeting-copilot] API ready at http://${env.host}:${env.port} (${env.nodeEnv})`,
  );
  console.log(`[meeting-copilot] WebSocket listening on ${env.wsPath}`);
});

const shutdown = (signal: string) => {
  console.log(`\n[meeting-copilot] received ${signal}, shutting down...`);
  server.close(() => process.exit(0));
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
