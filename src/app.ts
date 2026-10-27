import Fastify from 'fastify';
import type { Config } from './config.js';
import { ServiceError } from './errors.js';
import { GitHubClient } from './github/client.js';
import { GitHubCollector } from './github/collector.js';
import { IngestionService } from './github/ingestion.js';
import { repositoryParams, syncBody } from './github/model.js';
import { InsightsService } from './insights/service.js';
import { SqliteSnapshotCache } from './storage/cache.js';

export function buildApp(config: Config, dependencies: { ingestion?: IngestionService } = {}) {
  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
    bodyLimit: 64 * 1024,
    requestTimeout: 30_000,
    trustProxy: false,
  });

  const ingestion = dependencies.ingestion ?? new IngestionService(
    new GitHubCollector(new GitHubClient(config.GITHUB_TOKEN)),
    new SqliteSnapshotCache(config.DATABASE_PATH, config.CACHE_TTL_SECONDS),
    config.CACHE_TTL_SECONDS,
  );
  app.addHook('onClose', async () => ingestion.close());
  const insights = new InsightsService(ingestion);

  app.get('/api/repos/:owner/:repo/insights', async (request, reply) => {
    const params = repositoryParams.safeParse(request.params);
    const query = syncBody.safeParse(request.query);
    if (!params.success || !query.success) {
      throw new ServiceError(400, 'INVALID_INPUT', 'Use a valid repository and ISO-8601 from/to query timestamps spanning at most 90 days');
    }
    reply.header('Cache-Control', 'no-store');
    return insights.get(params.data.owner, params.data.repo, query.data);
  });

  app.post('/api/repos/:owner/:repo/sync', async (request, reply) => {
    const params = repositoryParams.safeParse(request.params);
    const body = syncBody.safeParse(request.body);
    if (!params.success || !body.success) {
      throw new ServiceError(400, 'INVALID_INPUT', 'Use a valid repository and ISO-8601 from/to timestamps spanning at most 90 days');
    }
    reply.header('Cache-Control', 'no-store');
    return ingestion.sync(params.data.owner, params.data.repo, body.data);
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
    if (error instanceof ServiceError) {
      if (error.retryAfter) reply.header('Retry-After', error.retryAfter);
      return reply.status(error.statusCode).send({ error: error.message, code: error.code, requestId: request.id });
    }
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
