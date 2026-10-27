import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

const { path, ttlSeconds } = workerData as { path: string; ttlSeconds: number };
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(path);
if (path !== ':memory:') chmodSync(path, 0o600);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS snapshots (
    key TEXT PRIMARY KEY,
    fetched_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    payload TEXT NOT NULL
  );
`);

parentPort!.on('message', (message: { id: number; operation: 'get' | 'set' | 'close'; key?: string; snapshot?: unknown }) => {
  try {
    let value: unknown = null;
    if (message.operation === 'get') {
      const row = db.prepare('SELECT payload FROM snapshots WHERE key = ? AND expires_at > ?')
        .get(message.key!, Date.now()) as { payload: string } | undefined;
      value = row ? JSON.parse(row.payload) : null;
    } else if (message.operation === 'set') {
      const payload = JSON.stringify(message.snapshot);
      if (Buffer.byteLength(payload) > 8 * 1024 * 1024) {
        parentPort!.postMessage({ id: message.id, error: 'TOO_LARGE' });
        return;
      }
      const now = Date.now();
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('DELETE FROM snapshots WHERE expires_at <= ?').run(now);
        db.prepare('INSERT OR REPLACE INTO snapshots (key, fetched_at, expires_at, payload) VALUES (?, ?, ?, ?)')
          .run(message.key!, now, now + ttlSeconds * 1000, payload);
        db.exec('DELETE FROM snapshots WHERE key IN (SELECT key FROM snapshots ORDER BY fetched_at DESC, key LIMIT -1 OFFSET 100)');
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    } else {
      db.close();
      parentPort!.postMessage({ id: message.id, value });
      parentPort!.close();
      return;
    }
    parentPort!.postMessage({ id: message.id, value });
  } catch {
    // Never send database paths or cached payloads into HTTP errors/logs.
    parentPort!.postMessage({ id: message.id, error: 'STORAGE_UNAVAILABLE' });
  }
});
