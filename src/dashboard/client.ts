import type { InsightsReport } from '../narrative/facts.js';
import type { NarrativeService } from '../narrative/service.js';
import type { MetricKey } from '../insights/definitions.js';

type Narrative = Awaited<ReturnType<NarrativeService['get']>>;
type Selection = { owner: string; repo: string; from: string; to: string };
const titles: Record<MetricKey, string> = {
  mergedPrCount: 'Merged PRs',
  closedWithoutMergeCount: 'Closed without merge',
  closedWithoutMergeRatePercent: 'Unmerged closure rate',
  medianMergeHours: 'Median merge time',
  medianFirstReviewHours: 'Time to first review',
  medianPostFirstReviewHours: 'Time after first review',
  medianChangedLines: 'Median changed lines',
  reviewedMergedPrPercent: 'Review coverage',
  reviewCount: 'Review submissions',
  distinctReviewers: 'Distinct reviewers',
  topReviewerSharePercent: 'Top reviewer share',
};
const mainMetrics: MetricKey[] = [
  'mergedPrCount',
  'medianMergeHours',
  'medianFirstReviewHours',
  'reviewedMergedPrPercent',
];
const number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
function get<K extends keyof HTMLElementTagNameMap>(
  id: string,
  tag: K,
): HTMLElementTagNameMap[K] {
  const node = document.getElementById(id);
  if (!node || node.tagName.toLowerCase() !== tag)
    throw new Error(`Missing dashboard element: ${id}`);
  return node as HTMLElementTagNameMap[K];
}
const form = get('query-form', 'form');
const repository = get('repository', 'input');
const from = get('from', 'input');
const to = get('to', 'input');
const analyze = get('analyze', 'button');
const generate = get('generate', 'button');
const reportSection = get('report', 'div');
const status = get('status', 'div');
const error = get('error', 'div');
const narrativeError = get('narrative-error', 'div');
const narrativeResult = get('narrative-result', 'div');
const narrativeStatus = get('narrative-status', 'p');
let revision = 0;
let active: AbortController | null = null;
let narrativeRequest: AbortController | null = null;
let report: InsightsReport | null = null;
let selection: Selection | null = null;

function message(node: HTMLElement, text: string) {
  node.textContent = text;
  node.hidden = !text;
}
function value(value: number | null, unit = '') {
  if (value === null) return 'Not available';
  const suffix =
    unit === 'hours'
      ? ' h'
      : unit === 'percent' || unit === 'percentage_points'
        ? unit === 'percent'
          ? '%'
          : ' pp'
        : '';
  return `${number.format(value)}${suffix}`;
}
function dateLabel(timestamp: string) {
  return new Date(timestamp).toLocaleDateString('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}
function timestampLabel(timestamp: string) {
  return (
    new Date(timestamp).toLocaleString('en-US', {
      timeZone: 'UTC',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
    }) + ' UTC'
  );
}
function path(query: Selection, endpoint: 'insights' | 'narrative') {
  return `/api/repos/${encodeURIComponent(query.owner)}/${encodeURIComponent(query.repo)}/${endpoint}`;
}
function currentSelection(): Selection {
  const match =
    /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\s*\/\s*([A-Za-z0-9_.-]{1,100})$/.exec(
      repository.value.trim(),
    );
  if (!match || match[2] === '.' || match[2] === '..')
    throw new Error('Enter a public repository as owner/repository.');
  const start = Date.parse(`${from.value}T00:00:00Z`);
  const end = Date.parse(`${to.value}T00:00:00Z`);
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    end - start > 90 * 86_400_000
  ) {
    throw new Error(
      'Choose an end date after the start date, spanning no more than 90 days. The end date is exclusive.',
    );
  }
  return {
    owner: match[1]!,
    repo: match[2]!,
    from: new Date(start).toISOString(),
    to: new Date(end).toISOString(),
  };
}
function friendlyError(code: string | undefined, retry: string | null) {
  const seconds =
    retry && /^\d{1,5}$/.test(retry) ? ` Try again in ${retry} seconds.` : '';
  const messages: Record<string, string> = {
    LLM_NOT_CONFIGURED:
      'Narratives aren’t enabled on this service. You can still explore the metrics and evidence.',
    NARRATIVE_BUSY: 'Another explanation is being generated.' + seconds,
    LLM_RATE_LIMITED:
      'The language model has reached its request limit.' + seconds,
    GITHUB_RATE_LIMITED: 'GitHub has reached its request limit.' + seconds,
    SYNC_BUSY: 'Other repositories are being analyzed.' + seconds,
    REPOSITORY_NOT_FOUND:
      'This public repository could not be found. Check the owner and repository name.',
    PUBLIC_REPOSITORY_REQUIRED: 'Choose a public GitHub repository.',
    COLLECTION_LIMIT:
      'This repository exceeds the collection limits. Try a shorter period or a smaller repository.',
    INVALID_INPUT: 'Check the repository and date range, then try again.',
    LLM_TIMEOUT:
      'The explanation took too long. Your metrics are still available; you can try again.',
    LLM_INVALID_EVIDENCE:
      'The explanation did not match its source facts, so it was withheld. Your metrics are still available.',
  };
  return code && messages[code]
    ? messages[code]
    : 'The request could not be completed. Please try again.';
}
async function request<T>(url: string, options: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...options, credentials: 'same-origin' });
  } catch (failure) {
    if (options.signal?.aborted) throw failure;
    throw new Error(
      'Could not reach the service. Check your connection and try again.',
    );
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      'The service returned an unreadable response. Please try again.',
    );
  }
  if (!response.ok) {
    const code =
      typeof body === 'object' &&
      body !== null &&
      'code' in body &&
      typeof body.code === 'string'
        ? body.code
        : undefined;
    throw new Error(friendlyError(code, response.headers.get('Retry-After')));
  }
  return body as T;
}
function setLoading(loading: boolean) {
  analyze.disabled = loading;
  analyze.textContent = loading
    ? 'Fetching GitHub data…'
    : 'Analyze repository →';
  analyze.classList.toggle('loading', loading);
  form.setAttribute('aria-busy', String(loading));
}
function invalidate() {
  revision++;
  active?.abort();
  narrativeRequest?.abort();
  active = null;
  narrativeRequest = null;
  report = null;
  selection = null;
  setLoading(false);
  generate.disabled = true;
  generate.textContent = 'Generate explanation';
  reportSection.hidden = true;
  get('welcome', 'section').hidden = false;
  message(error, '');
  message(narrativeError, '');
  message(narrativeStatus, '');
  narrativeResult.replaceChildren();
  narrativeResult.hidden = true;
}
form.addEventListener('input', () => {
  invalidate();
  status.textContent = 'Selection changed. Analyze to refresh the results.';
});

function evidenceButton(ids: string[], label: string, context: string) {
  const button = element('button', 'text-button', label);
  button.type = 'button';
  button.addEventListener('click', () => {
    if (!report) return;
    renderEvidence(report, new Set(ids), context);
    const section = get('evidence-section', 'section');
    section.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'start',
    });
    get('evidence-heading', 'h2').focus({ preventScroll: true });
  });
  return button;
}
function changeLabel(data: InsightsReport, key: MetricKey) {
  const change = data.changes[key];
  if (change.absolute === null) return 'Comparison unavailable';
  const unit = data.definitions[key].unit;
  const absolute = value(
    Math.abs(change.absolute),
    unit === 'percent' ? 'percentage_points' : unit,
  );
  if (change.absolute === 0) return 'Unchanged from previous';
  const direction = change.absolute > 0 ? '+' : '−';
  const relative =
    change.relativePercent === null
      ? ' · zero baseline'
      : unit === 'percent'
        ? ''
        : ` (${change.relativePercent > 0 ? '+' : ''}${number.format(change.relativePercent)}%)`;
  return `${direction}${absolute}${relative} vs previous`;
}
function renderMetrics(data: InsightsReport) {
  const cards = get('metric-cards', 'section');
  cards.replaceChildren();
  for (const key of mainMetrics) {
    const metric = data.current.metrics[key];
    const previous = data.previous.metrics[key];
    const unit = data.definitions[key].unit;
    const card = element('article', 'metric-card');
    card.dataset.metric = key;
    card.append(
      element('h3', 'metric-title', titles[key]),
      element(
        'p',
        'metric-value',
        metric.value === null ? '—' : value(metric.value, unit),
      ),
      element(
        'p',
        'metric-previous',
        `Previous: ${value(previous.value, unit)}`,
      ),
      element('p', 'metric-change', changeLabel(data, key)),
    );
    const bars = element('div', 'bar-pair');
    bars.setAttribute('aria-hidden', 'true');
    const max = Math.max(metric.value ?? 0, previous.value ?? 0, 1);
    for (const [item, className] of [
      [metric, 'current'],
      [previous, 'previous'],
    ] as const) {
      const bar = element('progress', className);
      bar.max = max;
      bar.value = item.value ?? 0;
      bars.append(bar);
    }
    card.append(
      bars,
      element(
        'p',
        'metric-sample',
        `${metric.sampleSize} ${unit === 'percent' ? (metric.sampleSize === 1 ? 'PR in denominator' : 'PRs in denominator') : metric.sampleSize === 1 ? 'observation' : 'observations'} · selected period`,
      ),
      evidenceButton(
        metric.evidenceIds,
        `View ${metric.evidenceIds.length} source PR${metric.evidenceIds.length === 1 ? '' : 's'}`,
        titles[key],
      ),
    );
    cards.append(card);
  }
  const table = element('table');
  const head = element('thead');
  const row = element('tr');
  for (const title of ['Metric / definition', 'Selected', 'Previous', 'Change'])
    row.append(element('th', '', title));
  head.append(row);
  table.append(head);
  const body = element('tbody');
  for (const key of Object.keys(titles) as MetricKey[]) {
    const row = element('tr');
    const label = element('td');
    label.append(
      element('span', '', titles[key]),
      element('span', 'metric-definition', data.definitions[key].definition),
    );
    row.append(
      label,
      element(
        'td',
        '',
        value(data.current.metrics[key].value, data.definitions[key].unit),
      ),
      element(
        'td',
        '',
        value(data.previous.metrics[key].value, data.definitions[key].unit),
      ),
      element('td', '', changeLabel(data, key)),
    );
    body.append(row);
  }
  table.append(body);
  get('all-metrics', 'div').replaceChildren(table);
}
function renderPeople(data: InsightsReport) {
  for (const kind of ['contributors', 'reviewers'] as const) {
    const container = get(kind, 'div');
    container.replaceChildren();
    const people = data.current[kind].slice(0, 5);
    if (!people.length) {
      container.append(
        element(
          'p',
          'empty-table',
          kind === 'contributors'
            ? 'No identifiable merged contributors in this period.'
            : 'No qualifying reviewers in this merged-PR cohort.',
        ),
      );
      continue;
    }
    const table = element('table');
    const head = element('thead');
    const row = element('tr');
    for (const label of kind === 'contributors'
      ? ['Account', 'Merged', 'Lines ±', 'Evidence']
      : ['Account', 'Reviews', 'PRs', 'Share', 'Evidence'])
      row.append(element('th', '', label));
    head.append(row);
    table.append(head);
    const body = element('tbody');
    if (kind === 'contributors')
      for (const person of data.current.contributors.slice(0, 5)) {
        const row = element('tr');
        const sources = element('td');
        sources.append(
          evidenceButton(
            person.evidenceIds,
            `${person.evidenceIds.length} PR${person.evidenceIds.length === 1 ? '' : 's'}`,
            `Merged contributions · ${person.login}`,
          ),
        );
        row.append(
          element('td', 'account', person.login),
          element('td', '', number.format(person.mergedPrCount)),
          element('td', '', number.format(person.changedLines)),
          sources,
        );
        body.append(row);
      }
    if (kind === 'reviewers')
      for (const person of data.current.reviewers.slice(0, 5)) {
        const row = element('tr');
        const sources = element('td');
        sources.append(
          evidenceButton(
            person.evidenceIds,
            `${person.evidenceIds.length} PR${person.evidenceIds.length === 1 ? '' : 's'}`,
            `Review participation · ${person.login}`,
          ),
        );
        row.append(
          element('td', 'account', person.login),
          element('td', '', number.format(person.reviewCount)),
          element('td', '', number.format(person.reviewedPrCount)),
          element('td', '', `${number.format(person.sharePercent)}%`),
          sources,
        );
        body.append(row);
      }
    table.append(body);
    container.append(table);
  }
}
function safeSourceLink(url: string, label: string) {
  try {
    const parsed = new URL(url);
    if (
      parsed.origin !== 'https://github.com' ||
      parsed.username ||
      parsed.password ||
      !/^\/[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/.test(parsed.pathname) ||
      (parsed.hash && !/^#pullrequestreview-\d+$/.test(parsed.hash))
    )
      throw new Error('Unsafe source');
    const link = element('a', '', label);
    link.href = parsed.href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  } catch {
    return element('span', '', label);
  }
}
function renderEvidence(
  data: InsightsReport,
  filter?: Set<string>,
  context = 'All collected PRs',
) {
  const rows = data.evidence.filter((row) => !filter || filter.has(row.id));
  const container = get('evidence-list', 'div');
  container.replaceChildren();
  get('clear-filter', 'button').hidden = !filter;
  get('evidence-context', 'p').textContent =
    `${context} · ${rows.length} source PR${rows.length === 1 ? '' : 's'}. Expand a row for lifecycle and review evidence.`;
  if (!rows.length)
    container.append(
      element(
        'p',
        'empty-table',
        'No source PRs contribute to this selection. Zero counts can have no PR evidence.',
      ),
    );
  for (const item of rows) {
    const details = element('details', 'evidence-row');
    const summary = element('summary');
    const cohort =
      item.cohort === 'backlog'
        ? 'Current backlog'
        : item.cohort === 'previous'
          ? 'Previous period'
          : 'Selected period';
    summary.append(
      safeSourceLink(item.url, `PR #${item.number}`),
      document.createTextNode(` · ${item.author ?? 'Unknown author'}`),
      element('span', 'tag', cohort),
    );
    details.append(
      summary,
      element(
        'p',
        'evidence-meta',
        `${number.format(item.changedLines)} changed lines · created ${dateLabel(item.createdAt)}${item.mergedAt ? ` · merged ${dateLabel(item.mergedAt)}` : item.closedAt ? ` · closed ${dateLabel(item.closedAt)}` : ' · currently open'}`,
      ),
    );
    if (item.mergeHours !== null)
      details.append(
        element(
          'p',
          'evidence-meta',
          `${value(item.mergeHours, 'hours')} to merge · first review: ${value(item.firstReviewHours, 'hours')}`,
        ),
      );
    if (item.reviews.length) {
      const reviews = element('ul');
      for (const review of item.reviews.slice(0, 5)) {
        const row = element('li');
        row.append(
          safeSourceLink(
            review.url,
            `${review.author} · ${review.state.toLowerCase().replaceAll('_', ' ')} · ${timestampLabel(review.submittedAt)}`,
          ),
        );
        reviews.append(row);
      }
      if (item.reviews.length > 5)
        reviews.append(
          element(
            'li',
            'muted',
            `Showing 5 of ${item.reviews.length} qualifying reviews. Open the PR for the rest.`,
          ),
        );
      details.append(reviews);
    }
    container.append(details);
  }
}
get('clear-filter', 'button').addEventListener('click', () => {
  if (report) renderEvidence(report);
});
function renderReport(data: InsightsReport, query: Selection) {
  get('welcome', 'section').hidden = true;
  reportSection.hidden = false;
  get('repository-heading', 'h2').textContent = data.repository;
  get('period-label', 'p').textContent =
    `${dateLabel(data.current.period.from)} – before ${dateLabel(data.current.period.to)} · ${data.defaultBranch} branch`;
  get('baseline-label', 'p').textContent =
    `Baseline: ${dateLabel(data.previous.period.from)} – before ${dateLabel(data.previous.period.to)}`;
  get('freshness', 'span').textContent =
    `Source fetched ${timestampLabel(data.source.fetchedAt)}${data.source.cache.hit ? ' · cached' : ''}`;
  get('api-link', 'a').href =
    `${path(query, 'insights')}?${new URLSearchParams({ from: query.from, to: query.to })}`;
  get('empty-cohort', 'div').hidden =
    data.current.metrics.mergedPrCount.value !== 0;
  renderMetrics(data);
  renderPeople(data);
  renderEvidence(data);
  const warnings = get('warnings', 'ul');
  warnings.replaceChildren();
  for (const warning of data.warnings)
    warnings.append(
      element(
        'li',
        '',
        `${warning.period === 'previous' ? 'Previous period: ' : warning.period === 'current' ? 'Selected period: ' : ''}${warning.message}`,
      ),
    );
  get('quality-summary', 'summary').textContent =
    `${data.warnings.length} data quality note${data.warnings.length === 1 ? '' : 's'} · check sample sizes`;
  get('quality', 'details').hidden = data.warnings.length === 0;
  const stats = element('dl', 'backlog-stats');
  for (const [label, amount] of [
    ['Open PRs', data.currentBacklog.openPrCount],
    ['Drafts', data.currentBacklog.draftPrCount],
    ['Median age', data.currentBacklog.medianAgeHours],
  ] as const) {
    const group = element('div');
    group.append(
      element('dt', '', label),
      element(
        'dd',
        '',
        amount === null
          ? '—'
          : value(amount, label === 'Median age' ? 'hours' : ''),
      ),
    );
    stats.append(group);
  }
  get('backlog-stats', 'div').replaceChildren(stats);
  get('backlog-time', 'p').textContent =
    `As of ${timestampLabel(data.currentBacklog.asOf)} · ${data.currentBacklog.ageSampleSize} age samples`;
  generate.disabled = false;
}
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  let query: Selection;
  try {
    query = currentSelection();
  } catch (failure) {
    message(
      error,
      failure instanceof Error ? failure.message : 'Check your selection.',
    );
    return;
  }
  invalidate();
  const currentRevision = revision;
  active = new AbortController();
  setLoading(true);
  status.textContent =
    'Collecting pull requests and reviews. Larger repositories can take up to two minutes.';
  try {
    const data = await request<InsightsReport>(
      `${path(query, 'insights')}?${new URLSearchParams({ from: query.from, to: query.to })}`,
      { signal: active.signal },
    );
    if (currentRevision !== revision) return;
    report = data;
    selection = query;
    renderReport(data, query);
    status.textContent = `Analysis loaded for ${data.repository}.`;
  } catch (failure) {
    if (currentRevision !== revision) return;
    report = null;
    selection = null;
    reportSection.hidden = true;
    get('welcome', 'section').hidden = false;
    generate.disabled = true;
    message(
      error,
      failure instanceof Error && !(failure instanceof TypeError)
        ? failure.message
        : 'The service returned an unexpected analysis. Please try again.',
    );
    status.textContent = '';
  } finally {
    if (currentRevision === revision) {
      setLoading(false);
      active = null;
    }
  }
});
function citationButtons(
  refs: Narrative['observations'][number]['evidence'],
  data: Narrative,
) {
  const list = element('div', 'citation-list');
  for (const ref of refs) {
    const fact = data.citedFacts.find((item) => item.id === ref.factId);
    if (!fact) continue;
    const [scope, key, change] = fact.id.split('.');
    const label =
      titles[key as MetricKey] ??
      (key === 'openPrCount'
        ? 'Open PRs'
        : key === 'draftPrCount'
          ? 'Draft PRs'
          : 'Median backlog age');
    const context = `${scope === 'current' ? 'Selected' : scope === 'previous' ? 'Previous' : scope === 'changes' ? 'Change' : 'Current backlog'} · ${label}${change === 'relativePercent' ? ' (relative)' : ''}: ${value(fact.value, fact.unit)}`;
    list.append(evidenceButton(fact.evidenceIds, context, context));
  }
  return list;
}
function renderNarrative(data: Narrative) {
  narrativeResult.replaceChildren();
  narrativeResult.hidden = false;
  for (const observation of data.observations)
    narrativeResult.append(
      element('p', 'narrative-observation', observation.text),
      citationButtons(observation.evidence, data),
    );
  const hypothesis = element('section', 'hypothesis');
  hypothesis.append(
    element(
      'h3',
      '',
      data.hypothesis.text
        ? 'A hypothesis to investigate'
        : 'No supported hypothesis',
    ),
  );
  if (data.hypothesis.text)
    hypothesis.append(element('p', '', data.hypothesis.text));
  hypothesis.append(
    element(
      'p',
      'confidence',
      data.hypothesis.text
        ? `Hypothesis confidence: ${number.format(data.hypothesis.confidence * 100)}% · not statistically calibrated`
        : 'Abstained · confidence 0',
    ),
  );
  hypothesis.append(
    element('p', 'muted', data.hypothesis.rationale),
    citationButtons(data.hypothesis.evidence, data),
  );
  narrativeResult.append(hypothesis);
  const limits = element('div', 'narrative-limits');
  limits.append(element('strong', '', 'Limits of this explanation'));
  const list = element('ul');
  for (const limitation of data.limitations)
    list.append(element('li', '', limitation));
  limits.append(
    list,
    element(
      'p',
      '',
      `Generated ${timestampLabel(data.generatedAt)}${data.cache.hit ? ' · cached explanation' : ''}. Verify the statements against their cited facts.`,
    ),
  );
  narrativeResult.append(limits);
}
generate.addEventListener('click', async () => {
  if (!report || !selection) return;
  const query = selection;
  const source = report.source.fetchedAt;
  let requiresRefresh = false;
  const currentRevision = revision;
  narrativeRequest?.abort();
  narrativeRequest = new AbortController();
  generate.disabled = true;
  message(narrativeError, '');
  narrativeResult.hidden = true;
  narrativeStatus.textContent =
    'Generating an explanation from the calculated facts…';
  generate.textContent = 'Generating…';
  try {
    const data = await request<Narrative>(path(query, 'narrative'), {
      method: 'POST',
      signal: narrativeRequest.signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: query.from, to: query.to }),
    });
    if (currentRevision !== revision) return;
    if (
      data.source.fetchedAt !== source ||
      data.source.repository.toLowerCase() !==
        report?.repository.toLowerCase() ||
      data.source.periods.current.from !== query.from ||
      data.source.periods.current.to !== query.to
    ) {
      requiresRefresh = true;
      throw new Error(
        'The source data refreshed during generation. Analyze the repository again to align the numbers and explanation.',
      );
    }
    renderNarrative(data);
    narrativeStatus.textContent =
      'Explanation generated. Follow the fact citations to inspect its evidence.';
  } catch (failure) {
    if (currentRevision !== revision) return;
    message(
      narrativeError,
      failure instanceof Error
        ? failure.message
        : 'Could not generate an explanation.',
    );
    narrativeStatus.textContent = '';
  } finally {
    if (currentRevision === revision) {
      generate.disabled = requiresRefresh;
      generate.textContent = 'Generate explanation';
      narrativeRequest = null;
    }
  }
});
const today = new Date();
const end = new Date(
  Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
);
from.value = new Date(end.getTime() - 30 * 86_400_000)
  .toISOString()
  .slice(0, 10);
to.value = end.toISOString().slice(0, 10);
get('example', 'button').addEventListener('click', () => {
  invalidate();
  repository.value = 'sindresorhus/p-limit';
  from.value = '2026-08-01';
  to.value = '2026-09-01';
  status.textContent =
    'Example selected. Analyze the repository to fetch its real GitHub data.';
  repository.focus();
});
