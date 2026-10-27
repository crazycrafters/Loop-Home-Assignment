import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

export function parseOptions(args) {
  let values;
  try {
    ({ values } = parseArgs({
      args,
      options: {
        'base-url': { type: 'string', default: 'http://127.0.0.1:3000' },
        repository: { type: 'string', default: 'sindresorhus/p-limit' },
        from: { type: 'string', default: '2026-08-01T00:00:00Z' },
        to: { type: 'string', default: '2026-09-01T00:00:00Z' },
        narrative: { type: 'boolean', default: false },
        'ui-only': { type: 'boolean', default: false },
      },
    }));
  } catch {
    throw new Error(
      'Use the documented smoke options, without positional arguments.',
    );
  }
  let base;
  try {
    base = new URL(values['base-url']);
  } catch {
    throw new Error('Use a valid HTTP(S) --base-url.');
  }
  ensure(
    ['http:', 'https:'].includes(base.protocol) &&
      !base.username &&
      !base.password &&
      !base.search &&
      !base.hash &&
      base.pathname === '/',
    'Base URL must be an HTTP(S) origin without credentials, path, query, or fragment.',
  );
  const match =
    /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{1,100})$/.exec(
      values.repository,
    );
  ensure(
    match && match[2] !== '.' && match[2] !== '..',
    'Use --repository owner/repository.',
  );
  const from = new Date(values.from),
    to = new Date(values.to);
  ensure(
    Number.isFinite(from.getTime()) &&
      Number.isFinite(to.getTime()) &&
      /T.*(?:Z|[+-]\d\d:\d\d)$/.test(values.from) &&
      /T.*(?:Z|[+-]\d\d:\d\d)$/.test(values.to),
    'Use timezone-qualified ISO-8601 timestamps.',
  );
  ensure(
    to - from > 0 && to - from <= 90 * 86400000,
    'Choose a positive period no longer than 90 days.',
  );
  ensure(
    !(values.narrative && values['ui-only']),
    '--narrative cannot be combined with --ui-only.',
  );
  return {
    base: base.origin,
    owner: match[1],
    repo: match[2],
    period: { from: from.toISOString(), to: to.toISOString() },
    narrative: values.narrative,
    uiOnly: values['ui-only'],
  };
}
function ensure(condition, message) {
  if (!condition) throw new Error(message);
}
async function get(base, path, options = {}) {
  let response;
  try {
    response = await fetch(base + path, {
      ...options,
      redirect: 'error',
      signal: AbortSignal.timeout(160000),
    });
  } catch {
    throw new Error(
      'Could not reach the service before its deadline; check --base-url and service startup.',
    );
  }
  if (!response.ok) {
    let body;
    try {
      body = await response.json();
    } catch {}
    const code =
      typeof body?.code === 'string' && /^[A-Z_]{1,80}$/.test(body.code)
        ? ` ${body.code}`
        : '';
    throw new Error(`Service returned HTTP ${response.status}${code}.`);
  }
  return response;
}
function close(actual, expected, message) {
  ensure(
    typeof actual === 'number' && Math.abs(actual - expected) < 0.000002,
    message,
  );
}
function validateInsights(report, selection) {
  ensure(
    report.repository.toLowerCase() ===
      `${selection.owner}/${selection.repo}`.toLowerCase(),
    'Unexpected repository in insights.',
  );
  ensure(
    report.current.period.from === selection.period.from &&
      report.current.period.to === selection.period.to,
    'Unexpected reporting period.',
  );
  const duration =
    Date.parse(selection.period.to) - Date.parse(selection.period.from);
  ensure(
    report.previous.period.to === selection.period.from &&
      Date.parse(report.previous.period.from) ===
        Date.parse(selection.period.from) - duration,
    'Baseline is not the preceding equal-duration period.',
  );
  ensure(
    report.current.metrics.mergedPrCount.value +
      report.previous.metrics.mergedPrCount.value >
      0,
    'No merged PR sample in either period; choose representative repository/dates for a functional smoke check.',
  );
  const evidence = new Map(report.evidence.map((row) => [row.id, row]));
  ensure(
    evidence.size === report.evidence.length,
    'Duplicate evidence identifiers.',
  );
  for (const cohort of ['current', 'previous']) {
    const rows = report.evidence.filter(
      (row) => row.cohort === cohort && row.mergedAt !== null,
    );
    ensure(
      report[cohort].metrics.mergedPrCount.value === rows.length,
      'Merged count does not reconcile with evidence.',
    );
    ensure(
      report[cohort].metrics.reviewCount.value ===
        rows.reduce((sum, row) => sum + row.reviews.length, 0),
      'Review count does not reconcile with evidence.',
    );
    const hours = rows
      .map(
        (row) =>
          (Date.parse(row.mergedAt) - Date.parse(row.createdAt)) / 3600000,
      )
      .filter((value) => value >= 0)
      .sort((a, b) => a - b);
    if (hours.length) {
      const middle = Math.floor(hours.length / 2);
      const median =
        hours.length % 2
          ? hours[middle]
          : (hours[middle - 1] + hours[middle]) / 2;
      close(
        report[cohort].metrics.medianMergeHours.value,
        median,
        'Merge-time median does not reconcile with source timestamps.',
      );
    } else
      ensure(
        report[cohort].metrics.medianMergeHours.value === null,
        'Empty timing sample must remain null.',
      );
    for (const metric of Object.values(report[cohort].metrics)) {
      ensure(
        metric.evidenceIds.every((id) => evidence.has(id)),
        'Metric refers to missing PR evidence.',
      );
      ensure(
        metric.value === null || Number.isFinite(metric.value),
        'Metric value is not finite.',
      );
    }
  }
  ensure(
    report.currentBacklog.openPrCount ===
      report.evidence.filter((row) => row.cohort === 'backlog').length,
    'Current backlog does not reconcile with evidence.',
  );
}
function validateNarrative(narrative, report) {
  ensure(
    narrative.source.repository === report.repository &&
      narrative.source.fetchedAt === report.source.fetchedAt,
    'Narrative and metrics use different snapshots; rerun against a fresh analysis.',
  );
  const known = new Map();
  for (const period of ['current', 'previous'])
    for (const [key, metric] of Object.entries(report[period].metrics))
      known.set(`${period}.${key}`, metric.value);
  for (const [key, change] of Object.entries(report.changes))
    for (const field of ['absolute', 'relativePercent'])
      known.set(`changes.${key}.${field}`, change[field]);
  for (const key of ['openPrCount', 'draftPrCount', 'medianAgeHours'])
    known.set(`backlog.${key}`, report.currentBacklog[key]);
  const cited = new Map(narrative.citedFacts.map((fact) => [fact.id, fact]));
  for (const claim of [...narrative.observations, narrative.hypothesis])
    for (const ref of claim.evidence) {
      ensure(
        known.has(ref.factId) &&
          known.get(ref.factId) === ref.value &&
          cited.get(ref.factId)?.value === ref.value,
        'Narrative citation does not match the independently requested metric.',
      );
    }
  const policy = narrative.confidencePolicy;
  const confidence = narrative.hypothesis.confidence;
  ensure(
    policy.calibrated === false &&
      confidence >= 0 &&
      confidence <= policy.appliedCap &&
      policy.appliedCap <= 0.75,
    'Invalid hypothesis confidence policy.',
  );
  if (narrative.hypothesis.text === null)
    ensure(
      confidence === 0 && narrative.hypothesis.evidence.length === 0,
      'Abstention must have zero confidence and no hypothesis citations.',
    );
  ensure(
    narrative.observations.length > 0 && narrative.narrative.length > 0,
    'Narrative contains no observations.',
  );
}

export async function smoke(options, log = console.log) {
  ensure(
    (await (await get(options.base, '/health')).json()).status === 'ok',
    'Health did not report ok.',
  );
  for (const [path, type, marker] of [
    ['/', 'text/html', 'Understand how work moves.'],
    ['/assets/dashboard.js', 'javascript', 'textContent'],
    ['/assets/dashboard.css', 'text/css', 'prefers-reduced-motion'],
  ]) {
    const response = await get(options.base, path);
    ensure(
      response.headers.get('content-type')?.includes(type) &&
        (await response.text()).includes(marker),
      'Dashboard asset or content type is incorrect.',
    );
  }
  log('PASS health, dashboard, and browser assets');
  if (options.uiOnly) {
    log('SKIP GitHub/LLM checks (--ui-only)');
    return;
  }
  const root = `/api/repos/${encodeURIComponent(options.owner)}/${encodeURIComponent(options.repo)}`;
  const url = `${root}/insights?${new URLSearchParams(options.period)}`;
  const report = await (await get(options.base, url)).json();
  validateInsights(report, options);
  log(
    `PASS GitHub insights and evidence (${report.current.metrics.mergedPrCount.value} selected / ${report.previous.metrics.mergedPrCount.value} previous merged PRs)`,
  );
  const repeat = await (await get(options.base, url)).json();
  ensure(
    repeat.source.cache.hit === true,
    'Immediate repeat did not hit the source cache.',
  );
  for (const key of ['current', 'previous', 'changes', 'evidence'])
    ensure(
      JSON.stringify(report[key]) === JSON.stringify(repeat[key]),
      'Cached analysis differs from its source snapshot.',
    );
  log('PASS repeat snapshot cache hit');
  if (!options.narrative) {
    log('SKIP LLM generation (explicit --narrative required)');
    return;
  }
  const narrative = await (
    await get(options.base, `${root}/narrative`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options.period),
    })
  ).json();
  validateNarrative(narrative, report);
  const repeated = await (
    await get(options.base, `${root}/narrative`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options.period),
    })
  ).json();
  ensure(
    repeated.cache.hit === true &&
      repeated.generatedAt === narrative.generatedAt,
    'Repeat narrative did not reuse the generated result.',
  );
  log('PASS narrative citations, confidence policy, and repeat cache hit');
  log(
    'MANUAL REVIEW required: confirm the prose follows from its evidence; numeric checks do not establish semantic accuracy.',
  );
}

// Importable for tests; CLI errors never dump response bodies, credentials, or stack traces.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await smoke(parseOptions(process.argv.slice(2)));
  } catch (error) {
    console.error(
      `FAIL ${error instanceof Error && error.name !== 'TypeError' ? error.message : 'Unexpected service response.'}`,
    );
    process.exitCode = 1;
  }
}
