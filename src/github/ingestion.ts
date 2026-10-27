import { ServiceError } from '../errors.js';
import type { SnapshotCache } from '../storage/cache.js';
import type { Period, Snapshot } from './model.js';

export interface Collector {
  collect(owner: string, repo: string, period: Period): Promise<Snapshot>;
}
export interface SyncResult { snapshot: Snapshot; cache: { hit: boolean; ttlSeconds: number } }

export class IngestionService {
  private inFlight = new Map<string, Promise<Snapshot>>();

  constructor(private readonly collector: Collector, private readonly cache: SnapshotCache, private readonly ttlSeconds: number) {}

  async sync(owner: string, repo: string, period: Period): Promise<SyncResult> {
    const canonical = { from: new Date(period.from).toISOString(), to: new Date(period.to).toISOString() };
    const key = JSON.stringify(['v1', owner.toLowerCase(), repo.toLowerCase(), canonical.from, canonical.to]);
    const cached = await this.cache.get(key);
    if (cached) return { snapshot: cached, cache: { hit: true, ttlSeconds: this.ttlSeconds } };
    let work = this.inFlight.get(key);
    if (!work) {
      if (this.inFlight.size >= 2) throw new ServiceError(503, 'SYNC_BUSY', 'Two syncs are already running; retry shortly', 5);
      work = this.collector.collect(owner, repo, canonical).then(async snapshot => {
        await this.cache.set(key, snapshot);
        return snapshot;
      });
      this.inFlight.set(key, work);
    }
    try {
      return { snapshot: await work, cache: { hit: false, ttlSeconds: this.ttlSeconds } };
    } finally {
      if (this.inFlight.get(key) === work) this.inFlight.delete(key);
    }
  }

  async close() {
    await Promise.allSettled(this.inFlight.values());
    await this.cache.close();
  }
}
