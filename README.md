# Loop repository insights

A GitHub collaboration insights service, built incrementally in feature PRs into `dev`.

The service will calculate pull-request delivery and review metrics and produce evidence-backed LLM narratives. See each milestone PR for available capabilities.

## Quickstart

Requires Node.js 24 and npm. No credentials or database are needed for milestone 1.

```sh
npm ci
npm run dev
```

In another terminal, `curl --fail http://127.0.0.1:3000/health` returns `{"status":"ok"}`.
The health endpoint is a process liveness check; it does not claim upstream API readiness.

For a production build:

```sh
npm run build
npm start
```

Run all checks with `npm run check` (type checking, tests, production compilation).
CI runs the same checks for PRs into `dev` and `main`.

## Configuration

The service reads process environment variables. `.env.example` documents defaults;
it is not automatically loaded. For a local file, copy it to `.env` and launch with
`node --env-file=.env --import tsx src/server.ts`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test`, or `production` |
| `HOST` | `127.0.0.1` | Bind address; use `0.0.0.0` in a container when needed |
| `PORT` | `3000` | Integer from 1 through 65535 |
| `LOG_LEVEL` | `info` | Standard Pino log level or `silent` |

Invalid configuration prevents startup without printing supplied values. Keep tokens
out of Git and logs. Request logs redact authorization and cookie headers. JSON bodies
are limited to 64 KiB, unexpected HTTP errors return generic messages with a request
ID, and SIGINT/SIGTERM close the server gracefully.

## Architecture and milestones

`src/config.ts` validates configuration; `src/app.ts` builds the HTTP application
without listening, so tests can exercise real request handling; `src/server.ts`
owns startup and shutdown. Fastify provides HTTP handling and structured logging;
Zod validates configuration. Strict TypeScript and a committed npm lockfile make
builds reproducible.

Next milestones add GitHub ingestion and SQLite caching, delivery metrics, LLM
narratives, a dashboard, and a complete demo. This milestone intentionally has no
GitHub or LLM credentials, integrations, or metrics endpoints yet.

Feature branches target `dev`. The repository owner opens the final `dev` → `main` PR.
