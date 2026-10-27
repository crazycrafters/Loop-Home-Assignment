import { Worker } from 'node:worker_threads';
import { ServiceError } from '../errors.js';
import type { Snapshot } from '../github/model.js';

export interface SnapshotCache {
  get(key: string): Promise<Snapshot | null>;
  set(key: string, snapshot: Snapshot): Promise<void>;
  close(): Promise<void>;
}

/** SQLite and JSON serialization run off the HTTP event loop. */
export class SqliteSnapshotCache implements SnapshotCache {
  private worker: Worker | undefined;
  private sequence = 0;
  private closed = false;
  private failed = false;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  constructor(private readonly path: string, private readonly ttlSeconds: number) {}

  private fail() {
    this.failed = true;
    for (const request of this.pending.values()) {
      request.reject(new ServiceError(503, 'STORAGE_UNAVAILABLE', 'Snapshot storage unavailable'));
    }
    this.pending.clear();
  }

  private send(operation: 'get' | 'set' | 'close', key?: string, snapshot?: Snapshot): Promise<unknown> {
    if (this.failed || (this.closed && operation !== 'close')) {
      return Promise.reject(new ServiceError(503, 'STORAGE_UNAVAILABLE', 'Snapshot storage unavailable'));
    }
    if (!this.worker) {
      const extension = import.meta.url.endsWith('.ts') ? 'ts' : 'js';
      this.worker = new Worker(new URL(`./cache-worker.${extension}`, import.meta.url), {
        workerData: { path: this.path, ttlSeconds: this.ttlSeconds },
      });
      this.worker.on('message', (message: { id: number; value?: unknown; error?: string }) => {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        if (message.error) {
          request.reject(message.error === 'TOO_LARGE'
            ? new ServiceError(422, 'COLLECTION_LIMIT', 'Snapshot exceeds the 8 MiB storage limit')
            : new ServiceError(503, 'STORAGE_UNAVAILABLE', 'Snapshot storage unavailable'));
        } else request.resolve(message.value);
      });
      this.worker.on('error', () => this.fail());
      this.worker.on('exit', () => { if (this.pending.size || !this.closed) this.fail(); });
    }
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ id, operation, key, snapshot });
    });
  }

  async get(key: string): Promise<Snapshot | null> {
    return await this.send('get', key) as Snapshot | null;
  }
  async set(key: string, snapshot: Snapshot): Promise<void> {
    await this.send('set', key, snapshot);
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (!this.worker) return;
    try {
      if (!this.failed) await this.send('close');
    } finally {
      await this.worker.terminate();
    }
  }
}
