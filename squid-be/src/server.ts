import 'dotenv/config';
import { server, initGateway } from './app';
import { envParser } from './lib/envParser';

const { NODE_ENV, PORT } = envParser;
const host = NODE_ENV === 'development' ? '127.0.0.1' : '0.0.0.0';

async function start() {
  // Build the gateway schema before accepting traffic so the first request
  // does not race the Squidex introspection (and we fail fast if it is down).
  await initGateway();

  server.on('error', (err) => {
    console.error('Server error:', err);
    process.exit(1);
  });

  server.listen(PORT, host, () =>
    console.log(`Server started on ${host}:${PORT}`),
  );
}

function shutdown(signal: string) {
  console.log(`${signal} received, shutting down gracefully...`);
  // A signal during the boot window (before listen) must not call close() on a
  // server that was never listening — that errors out with a non-zero exit.
  if (!server.listening) {
    process.exit(0);
  }
  server.close((err) => {
    if (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
    process.exit(0);
  });
  // Force-exit if connections do not drain in time.
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

start().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});

export default server;
