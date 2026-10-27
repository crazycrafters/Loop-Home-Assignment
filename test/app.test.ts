import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

function app() {
  return buildApp(loadConfig({ NODE_ENV: 'test', LOG_LEVEL: 'silent' }));
}

test('health returns the documented JSON response', async t => {
  const server = app();
  t.after(() => server.close());
  const response = await server.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type']!, /application\/json/);
  assert.deepEqual(response.json(), { status: 'ok' });
});

test('unknown routes return structured 404 errors', async t => {
  const server = app();
  t.after(() => server.close());
  const response = await server.inject('/missing');
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, 'Not found');
  assert.equal(typeof response.json().requestId, 'string');
});

test('unexpected errors do not expose internal details', async t => {
  const server = app();
  server.get('/failure', async () => { throw new Error('private internal details'); });
  t.after(() => server.close());
  const response = await server.inject('/failure');
  assert.equal(response.statusCode, 500);
  assert.equal(response.json().error, 'Internal server error');
  assert.ok(!response.body.includes('private internal details'));
});

test('oversized JSON requests are rejected', async t => {
  const server = app();
  server.post('/payload', async () => ({ accepted: true }));
  t.after(() => server.close());
  const response = await server.inject({
    method: 'POST', url: '/payload', payload: { value: 'x'.repeat(65 * 1024) },
  });
  assert.equal(response.statusCode, 413);
  assert.equal(response.json().error, 'Invalid request');
});
