import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

test('dashboard and explicit assets are served with restrictive browser headers', async (t) => {
  const app = buildApp(
    loadConfig({
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_PATH: ':memory:',
    }),
  );
  t.after(() => app.close());
  for (const [path, type, expected] of [
    ['/', 'text/html', 'Understand how work moves.'],
    ['/assets/dashboard.js', 'text/javascript', 'textContent'],
    ['/assets/dashboard.css', 'text/css', 'prefers-reduced-motion'],
  ]) {
    const response = await app.inject(path!);
    assert.equal(response.statusCode, 200);
    assert.ok(response.headers['content-type']?.includes(type!));
    assert.ok(response.body.includes(expected!));
    assert.match(
      String(response.headers['content-security-policy']),
      /script-src 'self'/,
    );
    assert.ok(
      !String(response.headers['content-security-policy']).includes(
        'unsafe-inline',
      ),
    );
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['referrer-policy'], 'no-referrer');
  }
  for (const path of [
    '/assets/nope.js',
    '/assets/../config.ts',
    '/dashboard/client.ts',
    '/.env',
  ]) {
    assert.equal((await app.inject(path)).statusCode, 404);
  }
});
