import { readFile } from 'node:fs/promises';
import type { FastifyInstance } from 'fastify';

/** Explicit routes only: no user-controlled filesystem paths or asset traversal. */
export function registerDashboard(app: FastifyInstance) {
  const directory = new URL('../../dist/dashboard/', import.meta.url);
  for (const [route, file, type] of [
    ['/', 'index.html', 'text/html; charset=utf-8'],
    ['/assets/dashboard.js', 'client.js', 'text/javascript; charset=utf-8'],
    ['/assets/dashboard.css', 'styles.css', 'text/css; charset=utf-8'],
  ] as const) {
    app.get(route, async (_request, reply) =>
      reply
        .header(
          'Content-Security-Policy',
          "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        )
        .header('X-Content-Type-Options', 'nosniff')
        .header('Referrer-Policy', 'no-referrer')
        .header('Cache-Control', 'no-cache')
        .type(type)
        .send(await readFile(new URL(file, directory))),
    );
  }
}
