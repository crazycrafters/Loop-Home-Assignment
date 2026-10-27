import { z } from 'zod';
import { ServiceError } from '../errors.js';

export type Fetch = typeof globalThis.fetch;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Fixed origin, locally constructed paths, no redirects or upstream Link URLs. */
export class GitHubClient {
  constructor(private readonly token?: string, private readonly fetcher: Fetch = globalThis.fetch) {}

  async get<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal): Promise<{ data: T; hasNext: boolean }> {
    if (!path.startsWith('/repos/') || path.startsWith('//')) throw new Error('Invalid GitHub path');
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'loop-repository-insights',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    for (let attempt = 0; attempt < 2; attempt++) {
      let response: Response;
      try {
        response = await this.fetcher(`https://api.github.com${path}`, {
          headers, redirect: 'error',
          signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
        });
      } catch {
        throw new ServiceError(502, 'GITHUB_UNAVAILABLE', 'GitHub request failed or timed out');
      }
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 429 || (response.status === 403 &&
            (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after')))) {
          const retry = Number(response.headers.get('retry-after'));
          const reset = Number(response.headers.get('x-ratelimit-reset')) * 1000 - Date.now();
          const delay = retry > 0 ? retry : reset > 0 ? Math.ceil(reset / 1000) : 60;
          throw new ServiceError(503, 'GITHUB_RATE_LIMITED', 'GitHub rate limit reached', Math.min(86400, delay));
        }
        if (response.status === 404) throw new ServiceError(404, 'REPOSITORY_NOT_FOUND', 'Repository or pull request not found');
        if (response.status === 401 || response.status === 403) {
          throw new ServiceError(502, 'GITHUB_ACCESS_DENIED', 'GitHub denied access; check the configured read-only token');
        }
        // Retry transient GET failures once, never rate limits or authorization failures.
        if ([502, 503, 504].includes(response.status) && attempt === 0 && !signal.aborted) continue;
        throw new ServiceError(502, 'GITHUB_UNAVAILABLE', 'GitHub returned an unsuccessful response');
      }
      try {
        const reader = response.body?.getReader();
        if (!reader) throw new Error('Empty response');
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_RESPONSE_BYTES) throw new Error('Response too large');
            chunks.push(value);
          }
        } finally {
          await reader.cancel();
        }
        const data = schema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        return { data, hasNext: /rel="next"/.test(response.headers.get('link') ?? '') };
      } catch {
        throw new ServiceError(502, 'GITHUB_INVALID_RESPONSE', 'GitHub returned an invalid or oversized response');
      }
    }
    throw new Error('Unreachable');
  }

  async *pages<T>(path: string, schema: z.ZodType<T>, signal: AbortSignal): AsyncGenerator<T[]> {
    for (let page = 1; page <= 20; page++) {
      const separator = path.includes('?') ? '&' : '?';
      const result = await this.get(`${path}${separator}per_page=100&page=${page}`, z.array(schema).max(100), signal);
      yield result.data;
      if (!result.hasNext) return;
    }
    throw new ServiceError(422, 'COLLECTION_LIMIT', 'Collection exceeds 20 pages; choose a smaller repository or period');
  }
}
