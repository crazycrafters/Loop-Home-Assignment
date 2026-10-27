import { copyFile, mkdir } from 'node:fs/promises';
const source = new URL('../src/dashboard/', import.meta.url);
const target = new URL('../dist/dashboard/', import.meta.url);
await mkdir(target, { recursive: true });
await Promise.all(
  ['index.html', 'styles.css'].map((file) =>
    copyFile(new URL(file, source), new URL(file, target)),
  ),
);
