import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().trim().min(1).default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_PATH: z.string().trim().min(1).default('./data/loop.sqlite'),
  CACHE_TTL_SECONDS: z.coerce.number().int().min(1).max(3600).default(300),
  LLM_API_KEY: z.string().trim().min(1).optional(),
  LLM_MODEL: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/).default('gpt-4.1-mini'),
  GITHUB_TOKEN: z.string().trim().min(1).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Report field names only: configuration values can contain secrets.
    throw new Error(`Invalid configuration: ${[...new Set(result.error.issues.map(issue => issue.path.join('.')))].join(', ')}`);
  }
  return result.data;
}
