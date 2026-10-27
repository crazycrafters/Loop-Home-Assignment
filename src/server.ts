import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main() {
  const config = loadConfig();
  const app = buildApp(config);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    const timer = setTimeout(() => process.exit(1), 10_000);
    timer.unref();
    try {
      await app.close();
    } catch {
      process.exitCode = 1;
    } finally {
      clearTimeout(timer);
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await app.listen({ host: config.HOST, port: config.PORT });
}

main().catch((error: unknown) => {
  // Startup errors must not dump process configuration or credentials.
  console.error(error instanceof Error && error.message.startsWith('Invalid configuration:')
    ? error.message : 'Service startup failed');
  process.exitCode = 1;
});
