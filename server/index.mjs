import { createApiServer } from './api.mjs';

const app = createApiServer();

try {
  const address = await app.listen();
  const host = typeof address === 'object' && address ? address.address : '127.0.0.1';
  const port = typeof address === 'object' && address ? address.port : 8787;
  console.log(`[api] MemoQuiz API listening on http://${host}:${port}`);
  console.log(`[api] database: ${app.dbPath}`);
  console.log('[api] health:   GET /api/health');
} catch (error) {
  console.error('[api] failed to start:', error);
  await app.close();
  process.exit(1);
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[api] ${signal} received, shutting down…`);
  await app.close();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));