# Running the packaged service

## Docker Compose

Requires Docker Engine and Compose v2; no host Node.js or database installation is
needed. From the repository root:

```sh
docker compose up --build --wait
docker compose exec -T app node scripts/check-container.mjs
docker compose exec -T app node scripts/smoke.mjs
```

The service binds host loopback on port 3000. `PORT=8080 docker compose up --build
--wait` changes the host port; the container still listens on 3000. The dashboard
is at the root page. `docker compose logs -f app` shows structured service logs.
Health checks establish liveness; `smoke.mjs` additionally fetches real GitHub data.

The image pins Node.js 24.19.0/bookworm-slim by digest, installs from the npm lockfile,
compiles the service/dashboard, and prunes development packages offline. The final
image runs as `node`, has no TypeScript/Playwright tools, and uses a read-only root
filesystem, dropped capabilities, and a writable named data volume. The included
runtime probe checks the actual user, SQLite read/write access, and dependency set.
It creates and removes only its own temporary probe directory.

To supply optional tokens, securely populate an ignored local `.env` or export the
variables in the invoking environment before starting Compose. `.env.example`
lists names and defaults; optional token lines remain commented rather than empty.
Compose forwards `GITHUB_TOKEN` and `LLM_API_KEY` only when configured. `LLM_MODEL`,
`LOG_LEVEL`, and `CACHE_TTL_SECONDS` have defaults. Restart/recreate after changes:

```sh
docker compose up -d --force-recreate --wait
# Explicit real LLM request; requires a configured provider and may incur API charges:
docker compose exec -T app node scripts/smoke.mjs --narrative
```

Do not use Compose's rendered configuration output to inspect secrets; it may print
resolved values. `docker compose config --quiet` validates syntax without dumping
configuration.

## Persistence and shutdown

SQLite snapshots live in the project-scoped `insights-data` named volume. Both
`docker compose restart` and `docker compose down` preserve it. Narratives are cached
only in memory and may incur another provider call after restart.

```sh
docker compose down
```

`docker compose down --volumes` also deletes the project's cached data; use it only
when intentionally resetting your own demo. No cleanup command affects unrelated
Compose projects. The service handles SIGTERM with a ten-second hard deadline;
Compose allows twelve seconds to stop it. GitHub/LLM credentials are runtime values,
not image layers or build arguments.

## Custom HTTPS trust / managed proxies

Keep Docker's configured proxy and registry authentication. If HTTPS interception
requires an additional public CA, the optional overlay supplies it as a BuildKit
secret for npm and a read-only runtime secret for Node:

```sh
PROXY_CA_FILE=/absolute/path/to/proxy-ca.pem \
  docker compose -f compose.yaml -f compose.proxy.yaml up --build --wait
```

In the managed cloud environment the source is the provided `CODEX_PROXY_CERT`:

```sh
PROXY_CA_FILE="$CODEX_PROXY_CERT" BUILDX_CONFIG=/workspace/.cache/loop-buildx \
  docker compose -f compose.yaml -f compose.proxy.yaml up --build --wait
```

The workspace Buildx cache avoids a read-only home directory and leaves
`DOCKER_CONFIG`/registry credentials intact. Confirm the managed daemon and proxy
configuration using the environment runtime instructions before Docker operations.
The CA is never copied into the image. No TLS, package-integrity, or artifact-digest
verification is disabled. Recreate containers if session-specific proxy settings
change. The default Compose file works with ordinary public TLS trust without
this overlay.

## CI and verified scope

CI runs two jobs: service/browser checks, and a container build with health/UI-only
smoke plus the non-root/SQLite/dependency probe. Container CI intentionally makes no
GitHub or paid provider requests. A separate current-instance validation fetched
real GitHub PRs #109/#108 through the container, reconciled counts/timings/evidence,
confirmed cache reuse, and restored the same snapshot after a container restart.
Live LLM generation remains pending a securely configured provider key; do not infer
provider readiness from container health or fixture-based tests.
