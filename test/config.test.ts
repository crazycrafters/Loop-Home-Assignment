import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

test('configuration defaults and explicit overrides', () => {
  assert.deepEqual(loadConfig({}), {
    NODE_ENV: 'development', HOST: '127.0.0.1', PORT: 3000, LOG_LEVEL: 'info',
    DATABASE_PATH: './data/loop.sqlite', CACHE_TTL_SECONDS: 300,
  });
  assert.equal(loadConfig({ PORT: '8080', NODE_ENV: 'production' }).PORT, 8080);
});

for (const port of ['', '0', '-1', '65536', '1.5', 'invalid']) {
  test(`rejects invalid port ${JSON.stringify(port)}`, () => {
    assert.throws(() => loadConfig({ PORT: port }), /Invalid configuration: PORT/);
  });
}

test('rejects invalid settings without leaking values', () => {
  assert.throws(() => loadConfig({ NODE_ENV: 'sensitive-value', HOST: ' ', LOG_LEVEL: 'bad' }),
    { message: 'Invalid configuration: NODE_ENV, HOST, LOG_LEVEL' });
});

test('storage and cache settings are validated without exposing token values', () => {
  for (const env of [{ CACHE_TTL_SECONDS: '0' }, { CACHE_TTL_SECONDS: '3601' }, { DATABASE_PATH: '' }]) {
    assert.throws(() => loadConfig(env), /Invalid configuration:/);
  }
  const config = loadConfig({ GITHUB_TOKEN: ' test-token ', CACHE_TTL_SECONDS: '60' });
  assert.equal(config.GITHUB_TOKEN, 'test-token');
  assert.equal(config.CACHE_TTL_SECONDS, 60);
});
