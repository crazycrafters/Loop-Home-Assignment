import assert from 'node:assert/strict';
import test from 'node:test';
import { ServiceError } from '../src/errors.js';
import { OpenAIProvider } from '../src/narrative/provider.js';
import { buildFacts, buildPrompt } from '../src/narrative/facts.js';
import { draft, fixtureInsights, providerResponse } from './narrative-fixtures.js';
import { fakeFetch, json, period } from './fixtures.js';

const input = async () => { const report = await fixtureInsights().get('acme', 'project', period); return buildPrompt(report, buildFacts(report)); };

test('Responses request uses fixed HTTPS origin, strict schema, no storage/tools/retries, and bounded output', async () => {
  const provider = new OpenAIProvider('fixture-not-a-secret', 'gpt-4.1-mini', fakeFetch((url, init) => {
    assert.equal(url.href, 'https://api.openai.com/v1/responses');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.store, false);
    assert.equal(payload.stream, false);
    assert.equal(payload.max_output_tokens, 1800);
    assert.equal(payload.tools, undefined);
    assert.equal(payload.text.format.type, 'json_schema');
    assert.equal(payload.text.format.strict, true);
    assert.equal(payload.text.format.schema.additionalProperties, false);
    assert.equal(payload.model, 'gpt-4.1-mini');
    assert.ok(!payload.input.includes('github.com'));
    return json(providerResponse(draft()));
  }));
  assert.deepEqual(await provider.generate(await input()), draft());
});

test('missing credentials fail before any provider request', async () => {
  let calls = 0;
  const provider = new OpenAIProvider(undefined, 'gpt-4.1-mini', fakeFetch(() => { calls++; return json({}); }));
  await assert.rejects(provider.generate(await input()), { code: 'LLM_NOT_CONFIGURED' });
  assert.equal(calls, 0);
});

test('rate limits and provider failures are sanitized and never retried', async () => {
  const data = await input();
  for (const [status, code] of [[429, 'LLM_RATE_LIMITED'], [401, 'LLM_ACCESS_DENIED'], [403, 'LLM_ACCESS_DENIED'], [500, 'LLM_UNAVAILABLE']] as const) {
    let calls = 0;
    const provider = new OpenAIProvider('fixture', 'gpt-4.1-mini', fakeFetch(() => {
      calls++; return json({ message: 'sensitive provider body' }, status, { 'retry-after': '12.5' });
    }));
    await assert.rejects(provider.generate(data), (error: unknown) => {
      assert.ok(error instanceof ServiceError);
      assert.equal(error.code, code);
      if (status === 429) assert.equal(error.retryAfter, 13);
      assert.ok(!error.message.includes('sensitive'));
      return true;
    });
    assert.equal(calls, 1);
  }
});

test('refusals, incomplete responses, malformed JSON, invalid schema and oversized bodies fail explicitly', async () => {
  const data = await input();
  const refusal = { ...providerResponse(draft()), output: [{ type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'private reason' }] }] };
  const fixtures = [
    [json(refusal), 'LLM_REFUSED'],
    [json({ ...providerResponse(draft()), status: 'incomplete' }), 'LLM_INVALID_RESPONSE'],
    [new Response('not json'), 'LLM_INVALID_RESPONSE'],
    [json(providerResponse({ unexpected: true })), 'LLM_INVALID_RESPONSE'],
    [new Response('x'.repeat(256 * 1024 + 1)), 'LLM_INVALID_RESPONSE'],
  ] as const;
  for (const [response, code] of fixtures) {
    const provider = new OpenAIProvider('fixture', 'gpt-4.1-mini', fakeFetch(() => response));
    await assert.rejects(provider.generate(data), { code });
  }
});

test('transport failures and timeouts map to safe errors without retries', async () => {
  const data = await input();
  const broken = new OpenAIProvider('fixture', 'gpt-4.1-mini', fakeFetch(() => { throw new Error('sensitive'); }));
  await assert.rejects(broken.generate(data), { code: 'LLM_UNAVAILABLE' });
  const timeout = new OpenAIProvider('fixture', 'gpt-4.1-mini', fakeFetch((_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  })), 5);
  // AbortSignal timeout timers are unref'ed; keep the test alive while awaiting the signal.
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(timeout.generate(data), { code: 'LLM_TIMEOUT' }); }
  finally { clearTimeout(keepAlive); }
});
