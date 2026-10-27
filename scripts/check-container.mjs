import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

// Probe the actual runtime user, mounted data directory, and dependency set.
if (typeof process.getuid !== 'function' || process.getuid() === 0)
  throw new Error('Container must run without root privileges.');
const directory = mkdtempSync(
  join(
    dirname(process.env.DATABASE_PATH ?? '/app/data/loop.sqlite'),
    '.runtime-probe-',
  ),
);
let db;
try {
  db = new DatabaseSync(join(directory, 'probe.sqlite'));
  db.exec('CREATE TABLE probe (value INTEGER NOT NULL)');
  db.prepare('INSERT INTO probe VALUES (?)').run(42);
  if (db.prepare('SELECT value FROM probe').get().value !== 42)
    throw new Error('SQLite read/write probe failed.');
} finally {
  db?.close();
  rmSync(directory, { recursive: true, force: true });
}
const require = createRequire(import.meta.url);
for (const dependency of ['typescript', 'tsx', '@playwright/test']) {
  let found = false;
  try {
    require.resolve(dependency);
    found = true;
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
  }
  if (found)
    throw new Error(
      'Development tooling must be omitted from the runtime image.',
    );
}
console.log(
  'PASS non-root runtime, writable SQLite volume, and production-only dependencies',
);
