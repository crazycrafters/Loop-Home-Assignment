import Fastify from 'fastify';
import type { Config } from './config.js';

export function buildApp(config: Config) {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
    bodyLimit: 64 * 1024,
    requestTimeout: 30_000,
    trustProxy: false,
  });

  app.get('/health', {
    schema: {
      response: {
        200: {
          type: 'object',
          additionalProperties: false,
          required: ['status'],
          properties: { status: { type: 'string', const: 'ok' } },
        },
      },
    },
  }, async () => ({ status: 'ok' }));

  app.setErrorHandler((error, request, reply) => {
    const code = typeof error === 'object' && error !== null && 'statusCode' in error
      ? error.statusCode : undefined;
    const status = typeof code === 'number' && Number.isInteger(code) && code >= 400 && code < 500
      ? code : 500;
    if (status >= 500) request.log.error({ err: error }, 'Request failed');
    return reply.status(status).send({
      error: status >= 500 ? 'Internal server error' : 'Invalid request',
      requestId: request.id,
    });
  });

  app.setNotFoundHandler((request, reply) => reply.status(404).send({
    error: 'Not found', requestId: request.id,
  }));

  return app;
}
