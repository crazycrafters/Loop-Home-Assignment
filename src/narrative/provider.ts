import { z } from 'zod';
import { ServiceError } from '../errors.js';
import type { Fetch } from '../github/client.js';
import type { NarrativeInput } from './facts.js';
import { instructions, narrativeDraftSchema, narrativeJsonSchema, type NarrativeDraft } from './schema.js';

export interface NarrativeProvider {
  readonly model: string;
  readonly configured: boolean;
  generate(input: NarrativeInput): Promise<NarrativeDraft>;
}
const responseSchema = z.object({
  status: z.string(),
  output: z.array(z.object({
    type: z.string(), role: z.string().optional(),
    content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  })).max(20),
});

export class OpenAIProvider implements NarrativeProvider {
  readonly configured: boolean;
  constructor(private readonly apiKey: string | undefined, readonly model: string, private readonly fetcher: Fetch = globalThis.fetch, private readonly timeoutMs = 30_000) {
    this.configured = Boolean(apiKey);
  }

  async generate(input: NarrativeInput): Promise<NarrativeDraft> {
    if (!this.apiKey) throw new ServiceError(503, 'LLM_NOT_CONFIGURED', 'Configure LLM_API_KEY securely to enable narratives');
    const signal = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      // No base-URL override, redirects, tools, streaming, persistence, or automatic retries.
      response = await this.fetcher('https://api.openai.com/v1/responses', {
        method: 'POST', redirect: 'error', signal,
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model, store: false, stream: false, max_output_tokens: 1800,
          instructions, input: JSON.stringify(input),
          text: { format: { type: 'json_schema', name: 'repository_narrative', strict: true, schema: narrativeJsonSchema } },
        }),
      });
    } catch {
      throw new ServiceError(signal.aborted ? 504 : 502, signal.aborted ? 'LLM_TIMEOUT' : 'LLM_UNAVAILABLE',
        'Narrative provider request failed or timed out');
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 429) {
        const retry = Number(response.headers.get('retry-after'));
        throw new ServiceError(503, 'LLM_RATE_LIMITED', 'Narrative provider rate limit reached',
          Number.isFinite(retry) && retry > 0 ? Math.min(3600, Math.ceil(retry)) : 60);
      }
      throw new ServiceError(502, response.status === 401 || response.status === 403 ? 'LLM_ACCESS_DENIED' : 'LLM_UNAVAILABLE',
        'Narrative provider rejected the request; check credentials, model access, and provider availability');
    }
    try {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Missing body');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 256 * 1024) throw new Error('Provider response too large');
          chunks.push(value);
        }
      } finally { await reader.cancel(); }
      const envelope = responseSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (envelope.status !== 'completed') throw new Error('Incomplete provider response');
      const content = envelope.output.filter(item => item.type === 'message' && item.role === 'assistant').flatMap(item => item.content ?? []);
      if (content.some(item => item.type === 'refusal')) {
        throw new ServiceError(502, 'LLM_REFUSED', 'Narrative provider declined to produce a narrative');
      }
      const text = content.filter(item => item.type === 'output_text');
      if (text.length !== 1 || !text[0]!.text) throw new Error('Missing structured text');
      return narrativeDraftSchema.parse(JSON.parse(text[0]!.text));
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError(signal.aborted ? 504 : 502, signal.aborted ? 'LLM_TIMEOUT' : 'LLM_INVALID_RESPONSE',
        'Narrative provider returned invalid, incomplete, or oversized output');
    }
  }
}
