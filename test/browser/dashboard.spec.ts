import { test, expect, type Page } from '@playwright/test';
import { fixtureInsights, draft } from '../narrative-fixtures.js';
import { NarrativeService } from '../../src/narrative/service.js';
import { period } from '../fixtures.js';

async function data() {
  const insights = fixtureInsights();
  const report = await insights.get('acme', 'project', period);
  const narrative = await new NarrativeService(
    insights,
    { model: 'fixture', configured: true, generate: async () => draft() },
    300,
  ).get('acme', 'project', period);
  return { report, narrative };
}
async function select(page: Page) {
  await page.getByLabel('GitHub repository').fill('acme/project');
  await page.locator('#from').fill('2026-01-01');
  await page.locator('#to').fill('2026-02-01');
}
async function analyze(page: Page) {
  await select(page);
  await page.getByRole('button', { name: 'Analyze repository' }).click();
  await expect(page.locator('#report')).toBeVisible();
}

test('initial state is usable without network calls; example presets a real repository without generating AI', async ({
  page,
}) => {
  const apiCalls: string[] = [];
  await page.route('**/api/**', (route) => {
    apiCalls.push(route.request().url());
    return route.abort();
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Understand how work moves.',
  );
  await expect(page.locator('#welcome')).toBeVisible();
  await page.getByRole('button', { name: 'Try an example' }).click();
  await expect(page.getByLabel('GitHub repository')).toHaveValue(
    'sindresorhus/p-limit',
  );
  await expect(page.locator('#from')).toHaveValue('2026-08-01');
  expect(apiCalls).toEqual([]);
  expect(errors).toEqual([]);
});

test('analysis renders real metric shapes, sample sizes, rankings and filtered source evidence', async ({
  page,
}) => {
  const { report } = await data();
  let narrativeCalls = 0;
  await page.route('**/api/**', async (route) => {
    if (route.request().url().endsWith('/narrative')) narrativeCalls++;
    await route.fulfill({ json: report });
  });
  await page.goto('/');
  await analyze(page);
  await expect(
    page.locator('[data-metric="mergedPrCount"] .metric-value'),
  ).toHaveText('4');
  await expect(
    page.locator('[data-metric="medianMergeHours"] .metric-value'),
  ).toHaveText('60 h');
  await expect(
    page.locator('[data-metric="medianFirstReviewHours"] .metric-sample'),
  ).toContainText('3 observations');
  await expect(page.locator('#contributors')).toContainText('alice');
  await expect(page.locator('#backlog-stats')).toContainText('780 h');
  await page
    .locator('[data-metric="medianMergeHours"]')
    .getByRole('button', { name: 'View 4 source PRs' })
    .click();
  await expect(page.locator('#evidence-list details')).toHaveCount(4);
  await expect(page.locator('#evidence-context')).toContainText(
    'Median merge time',
  );
  await page.getByRole('button', { name: 'Show all PRs' }).click();
  await expect(page.locator('#evidence-list details')).toHaveCount(8);
  const first = page.locator('#evidence-list details').first();
  await first.locator('summary').click({ position: { x: 8, y: 8 } });
  await expect(
    first.getByRole('link', { name: /bob · approved/i }),
  ).toHaveAttribute('href', /#pullrequestreview-11$/);
  expect(narrativeCalls).toBe(0);
});

test('explanation requires a click and links fact citations back to source PRs with cautious confidence', async ({
  page,
}) => {
  const { report, narrative } = await data();
  let calls = 0;
  await page.route('**/api/**', async (route) => {
    if (route.request().method() === 'POST') {
      calls++;
      expect(route.request().postDataJSON()).toEqual(period);
      await route.fulfill({ json: narrative });
    } else await route.fulfill({ json: report });
  });
  await page.goto('/');
  await analyze(page);
  expect(calls).toBe(0);
  await page.getByRole('button', { name: 'Generate explanation' }).click();
  await expect(page.locator('#narrative-result')).toContainText(
    'Four PRs merged',
  );
  await expect(page.locator('.confidence')).toHaveText(
    'Hypothesis confidence: 35% · not statistically calibrated',
  );
  await page
    .locator('#narrative-result .citation-list')
    .first()
    .getByRole('button')
    .first()
    .click();
  await expect(page.locator('#evidence-list details')).toHaveCount(4);
  expect(calls).toBe(1);
});

test('missing provider configuration leaves metrics intact and never asks the user for a key in the browser', async ({
  page,
}) => {
  const { report } = await data();
  await page.route('**/api/**', (route) =>
    route.fulfill(
      route.request().method() === 'POST'
        ? { status: 503, json: { code: 'LLM_NOT_CONFIGURED' } }
        : { json: report },
    ),
  );
  await page.goto('/');
  await analyze(page);
  await page.getByRole('button', { name: 'Generate explanation' }).click();
  await expect(page.locator('#narrative-error')).toContainText(
    'Narratives aren’t enabled',
  );
  await expect(
    page.locator('[data-metric="mergedPrCount"] .metric-value'),
  ).toHaveText('4');
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.locator('#narrative-result')).toBeHidden();
});

test('date validation prevents upstream calls and rate limits show actionable retry guidance', async ({
  page,
}) => {
  let calls = 0;
  await page.route('**/api/**', (route) => {
    calls++;
    return route.fulfill({
      status: 503,
      headers: { 'Retry-After': '60' },
      json: { code: 'GITHUB_RATE_LIMITED' },
    });
  });
  await page.goto('/');
  await select(page);
  await page.locator('#to').fill('2025-12-01');
  await page.getByRole('button', { name: 'Analyze repository' }).click();
  await expect(page.locator('#error')).toContainText('end date after');
  expect(calls).toBe(0);
  await page.locator('#to').fill('2026-02-01');
  await page.getByRole('button', { name: 'Analyze repository' }).click();
  await expect(page.locator('#error')).toContainText('Try again in 60 seconds');
  await expect(page.locator('#report')).toBeHidden();
});

test('selection changes invalidate old results and late responses cannot overwrite a newer analysis', async ({
  page,
}) => {
  const { report } = await data();
  let release!: () => void;
  const delayed = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started!: () => void;
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/api/**', async (route) => {
    if (route.request().url().includes('/acme/project/')) {
      started();
      await delayed;
    }
    await route.fulfill({
      json: {
        ...report,
        repository: route.request().url().includes('/other/repo/')
          ? 'other/repo'
          : 'acme/project',
      },
    });
  });
  await page.goto('/');
  await select(page);
  await page.getByRole('button', { name: 'Analyze repository' }).click();
  await ready;
  await page.getByLabel('GitHub repository').fill('other/repo');
  await page.getByRole('button', { name: 'Analyze repository' }).click();
  await expect(page.locator('#repository-heading')).toHaveText('other/repo');
  release();
  await expect(page.locator('#repository-heading')).toHaveText('other/repo');
});

test('a refreshed source snapshot cannot be paired with stale metric cards', async ({
  page,
}) => {
  const { report, narrative } = await data();
  narrative.source.fetchedAt = '2026-02-02T00:00:01.000Z';
  await page.route('**/api/**', (route) =>
    route.fulfill({
      json: route.request().method() === 'POST' ? narrative : report,
    }),
  );
  await page.goto('/');
  await analyze(page);
  await page.getByRole('button', { name: 'Generate explanation' }).click();
  await expect(page.locator('#narrative-error')).toContainText(
    'Analyze the repository again',
  );
  await expect(page.locator('#narrative-result')).toBeHidden();
});

test('untrusted model/account text renders literally and unsafe source URLs never become links', async ({
  page,
}) => {
  const { report, narrative } = await data();
  const injection = '<img src=x onerror="window.dashboardInjected=true">';
  report.current.contributors[0]!.login = injection;
  report.evidence[0]!.url = 'javascript:window.dashboardInjected=true';
  narrative.observations[0]!.text = injection;
  await page.route('**/api/**', (route) =>
    route.fulfill({
      json: route.request().method() === 'POST' ? narrative : report,
    }),
  );
  await page.goto('/');
  await analyze(page);
  await page.getByRole('button', { name: 'Generate explanation' }).click();
  await expect(page.locator('#narrative-result')).toContainText(injection);
  await expect(page.locator('#narrative-result img')).toHaveCount(0);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  expect(await page.evaluate(() => 'dashboardInjected' in window)).toBe(false);
});

test('mobile layout fits the viewport and keyboard users can reach the repository form', async ({
  page,
}) => {
  const { report } = await data();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/**', (route) => route.fulfill({ json: report }));
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeFocused();
  await analyze(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await expect(page.locator('#contributors')).toBeVisible();
  await page.screenshot({
    path: test.info().outputPath('dashboard-mobile.png'),
    fullPage: true,
  });
});

test('an unexpected success payload shows an error instead of a partial or stale dashboard', async ({
  page,
}) => {
  await page.route('**/api/**', (route) =>
    route.fulfill({ json: { unexpected: true } }),
  );
  await page.goto('/');
  await select(page);
  await page.getByRole('button', { name: 'Analyze repository' }).click();
  await expect(page.locator('#error')).toContainText('unexpected analysis');
  await expect(page.locator('#report')).toBeHidden();
  await expect(page.locator('#welcome')).toBeVisible();
});
