import { createHash } from 'node:crypto';
import { ServiceError } from '../errors.js';
import type { Period } from '../github/model.js';
import type { InsightsService } from '../insights/service.js';
import { buildFacts, buildPrompt } from './facts.js';
import type { NarrativeProvider } from './provider.js';
import { promptVersion } from './schema.js';
import { validateNarrative } from './validation.js';

type Result = Awaited<ReturnType<NarrativeService['generate']>>;

export class NarrativeService {
  private cache = new Map<string, { result: Result; expiresAt: number; bytes: number }>();
  private cacheBytes = 0;
  private inFlight = new Map<string, Promise<Result>>();

  constructor(private readonly insights: InsightsService, private readonly provider: NarrativeProvider, private readonly ttlSeconds: number) {}

  private evict(key: string) {
    const entry = this.cache.get(key);
    if (entry) this.cacheBytes -= entry.bytes;
    this.cache.delete(key);
  }

  async get(owner: string, repo: string, period: Period) {
    if (!this.provider.configured) throw new ServiceError(503, 'LLM_NOT_CONFIGURED', 'Configure LLM_API_KEY securely to enable narratives');
    const report = await this.insights.get(owner, repo, period);
    const facts = buildFacts(report);
    const input = buildPrompt(report, facts);
    const key = createHash('sha256').update(JSON.stringify({ repository: report.repository.toLowerCase(),
      defaultBranch: report.defaultBranch, model: this.provider.model, promptVersion, input, facts })).digest('hex');
    const now = Date.now();
    for (const [cachedKey, cached] of this.cache) if (cached.expiresAt <= now) this.evict(cachedKey);
    const cached = this.cache.get(key);
    if (cached) return { ...cached.result, cache: { hit: true, ttlSeconds: this.ttlSeconds } };
    let work = this.inFlight.get(key);
    if (!work) {
      if (this.inFlight.size >= 1) throw new ServiceError(503, 'NARRATIVE_BUSY', 'A narrative is already generating; retry shortly', 5);
      work = this.generate(report, facts, input).then(result => {
        const bytes = Buffer.byteLength(JSON.stringify(result));
        if (bytes <= 1024 * 1024) {
          this.cache.set(key, { result, bytes, expiresAt: Date.now() + this.ttlSeconds * 1000 });
          this.cacheBytes += bytes;
          while (this.cache.size > 50 || this.cacheBytes > 8 * 1024 * 1024) this.evict(this.cache.keys().next().value!);
        }
        return result;
      });
      this.inFlight.set(key, work);
    }
    try { return { ...await work, cache: { hit: false, ttlSeconds: this.ttlSeconds } }; }
    finally { if (this.inFlight.get(key) === work) this.inFlight.delete(key); }
  }

  private async generate(report: Awaited<ReturnType<InsightsService['get']>>, facts: ReturnType<typeof buildFacts>, input: ReturnType<typeof buildPrompt>) {
    const validated = validateNarrative(await this.provider.generate(input), facts, report);
    const ids = new Set(validated.citedFacts.flatMap(fact => fact.evidenceIds));
    return {
      schemaVersion: '1', promptVersion, model: this.provider.model, generatedAt: new Date().toISOString(),
      narrative: [...validated.draft.observations.map(item => item.text), validated.draft.hypothesis.text].filter(Boolean).join(' '),
      ...validated.draft, confidencePolicy: validated.confidencePolicy,
      source: { repository: report.repository, defaultBranch: report.defaultBranch, fetchedAt: report.source.fetchedAt,
        periods: { current: report.current.period, previous: report.previous.period } },
      citedFacts: validated.citedFacts, evidence: report.evidence.filter(row => ids.has(row.id)),
      methodology: report.methodology, warnings: report.warnings,
    };
  }
}
