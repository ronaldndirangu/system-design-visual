import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { concept } from '../../src/data/concepts';
import { journeys, stagePages } from '../../src/data/journeys';
import { emptyProgress, questionSetFingerprint } from '../../src/lib/progress';
import { documentOverflow, holdIslandCode, island } from './helpers';

const legacy = {
  version: 3,
  lessons: { 'thinking/anatomy-of-a-web-app': { completedAt: '2026-11-17T18:58:14.161Z' } },
  last: 'thinking/anatomy-of-a-web-app',
};

async function answerConcept(page: Page, slug: string, correct = true) {
  const entry = concept(slug);
  const quiz = page.getByRole('region', { name: 'Quick check', exact: true });
  await island(quiz);
  for (const [index, question] of entry.quiz.entries()) {
    const item = quiz.locator('.sdv-quiz__item').nth(index);
    const answer = question.options.find((option) => Boolean(option.correct) === correct);
    if (!answer) throw new Error(question.id);
    await item
      .locator('label')
      .filter({ has: page.getByText(answer.text, { exact: true }) })
      .getByRole('radio')
      .check();
    await item.getByRole('button', { name: 'Check answer' }).click();
  }
  return quiz;
}

test('returning lesson learner gets the correct hero continuation on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript((data) => localStorage.setItem('sdv:progress', JSON.stringify(data)), legacy);
  await page.goto('');
  const hero = page.locator('.sdv-hero');
  const next = hero.getByRole('link', { name: 'Continue: Requirements and estimates' });
  await expect(next).toBeVisible();
  expect((await next.boundingBox())?.y).toBeLessThan(600);
  await expect(hero.getByRole('link', { name: /Start/ })).toHaveCount(0);
  expect(await documentOverflow(page)).toBe(0);
});

test('concept attempts persist, enter review, retain lesson data and offer explicit practice', async ({
  page,
}) => {
  await page.addInitScript((data) => {
    if (!localStorage.getItem('sdv:progress')) localStorage.setItem('sdv:progress', JSON.stringify(data));
    if (!localStorage.getItem('sdv:review'))
      localStorage.setItem(
        'sdv:review',
        JSON.stringify({
          version: 1,
          cards: { 'scaling/caching/q1': { box: 4, due: '2099-01-01T00:00:00Z' } },
          checkpoints: {},
        }),
      );
  }, legacy);
  await page.goto('concepts/load-balancer/');
  await answerConcept(page, 'load-balancer', false);
  await page.reload();
  const quiz = page.getByRole('region', { name: 'Quick check', exact: true });
  await island(quiz);
  await expect(quiz).toContainText('Last check: 0 of 2');
  await expect(quiz).toContainText('Attempted.');
  await expect(quiz.getByRole('button', { name: 'Practice again' })).toBeVisible();
  await page.goto('review/');
  await expect(page.getByRole('region', { name: 'Due for review' })).toContainText(
    'Visual concept: Load balancer',
  );
  await page.goto('concepts/load-balancer/');
  await island(quiz);
  await quiz.getByRole('button', { name: 'Practice again' }).click();
  await answerConcept(page, 'load-balancer');
  await page.reload();
  await island(quiz);
  await expect(quiz).toContainText('Last check: 2 of 2');
  await expect(quiz).toContainText('Mastered on the latest check');
  const stored = await page.evaluate(() => ({
    progress: JSON.parse(localStorage.getItem('sdv:progress') ?? '{}'),
    review: JSON.parse(localStorage.getItem('sdv:review') ?? '{}'),
  }));
  expect(stored.progress.lessons['thinking/anatomy-of-a-web-app']).toEqual(
    legacy.lessons['thinking/anatomy-of-a-web-app'],
  );
  expect(stored.progress.last).toBe(legacy.last);
  expect(stored.review.cards['scaling/caching/q1']).toEqual({ box: 4, due: '2099-01-01T00:00:00Z' });
  await page.goto('');
  await expect(
    page.locator('.sdv-hero').getByRole('link', { name: 'Continue: Apply your concepts to a system' }),
  ).toBeVisible();
});

for (const id of ['search', 'distributed-storage']) {
  test(`${id} guides a fresh learner through shared basics into its scenario`, async ({ page }) => {
    const journey = journeys.find((item) => item.id === id);
    if (!journey) throw new Error(id);
    await page.goto(`journeys/${id}/`);
    const next = page.getByRole('region', { name: 'Your next step' });
    await expect(next).toContainText('Stage 1 of 4');
    await next.getByRole('link', { name: 'Next: Latency and throughput' }).click();
    await answerConcept(page, 'latency-throughput');
    await page.goto(`journeys/${id}/`);
    await expect(next).toContainText('1 of');
    await expect(next.getByRole('link', { name: 'Next: Availability' })).toBeVisible();
    const data = emptyProgress();
    data.journey = id;
    data.resume = `journeys/${id}`;
    for (const pageId of journey.stages
      .flatMap(stagePages)
      .filter((value) => value.startsWith('concepts/'))) {
      data.lessons[pageId] = {
        quizLast: { score: 2, total: 2, set: questionSetFingerprint(concept(pageId.slice(9)).quiz) },
      };
    }
    await page.evaluate((value) => localStorage.setItem('sdv:progress', JSON.stringify(value)), data);
    await page.reload();
    await expect(next).toContainText('Stage 4 of 4');
    await next.getByRole('link', { name: /^Next:/ }).click();
    await expect(page).toHaveURL(
      new RegExp(`/case-studies/${id === 'search' ? 'search' : 'kv-store'}/\\?journey=${id}$`),
    );
    await expect(page.getByText(/case 9 of 12|Take it after/)).toHaveCount(0);
    const completion = page.locator('.sdv-complete');
    await island(completion);
    await completion.getByRole('button', { name: 'Mark lesson complete' }).click();
    await page.goto(`journeys/${id}/`);
    await expect(next).toContainText('Path complete');
    await expect(next.getByRole('link', { name: 'Choose another system' })).toBeVisible();
  });
}

test('phone navigation surfaces destinations, collapses unrelated groups and supports keyboard steps', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('concepts/load-balancer/');
  await page.getByRole('button', { name: 'Menu' }).click();
  const sidebar = page.locator('#starlight__sidebar');
  for (const label of ['Learning paths', 'Start here', 'Review queue']) {
    const link = sidebar.getByRole('link', { name: label, exact: true });
    await expect(link).toBeVisible();
    expect((await link.boundingBox())?.y).toBeLessThan(450);
  }
  const group = (name: string) =>
    sidebar
      .locator('summary')
      .filter({ hasText: new RegExp(`^${name}$`) })
      .locator('..');
  await expect(group('Traffic')).toHaveAttribute('open', '');
  await expect(group('Data')).not.toHaveAttribute('open');
  await page.getByRole('button', { name: 'Menu' }).click();
  const figure = page.locator('figure.sdv-concept');
  await expect(figure).not.toHaveAttribute('data-playing');
  await figure.getByRole('button', { name: 'Next step' }).focus();
  await page.keyboard.press('Enter');
  await expect(figure.locator('[data-step-status]')).toHaveText('Step 1 of 3');
  await page.keyboard.press('Enter');
  await expect(figure.locator('[data-step-status]')).toHaveText('Step 2 of 3');
  await figure.getByRole('button', { name: 'Previous step' }).click();
  await expect(figure.locator('[data-step-status]')).toHaveText('Step 1 of 3');
  await figure.getByRole('radio', { name: 'With', exact: true }).check();
  await figure.getByRole('button', { name: 'Next step' }).click();
  await expect(figure.locator('[data-state="with"] [data-current-step]')).toHaveCount(1);
  const depth = page.locator('.sdv-concept-depth');
  await expect(depth).not.toHaveAttribute('open');
  expect(
    await page
      .locator('.sdv-concept-example')
      .evaluate((node) =>
        Boolean(
          node.compareDocumentPosition(document.querySelector('.sdv-concept-depth') as Node) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      ),
  ).toBe(true);
  await depth.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(depth).toHaveAttribute('open', '');
  expect(await documentOverflow(page)).toBe(0);
});

test('reduced motion retains manual steps without animation', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('concepts/load-balancer/');
  const figure = page.locator('figure.sdv-concept');
  await figure.getByRole('button', { name: 'Next step' }).click();
  await expect(figure.locator('[data-step-status]')).toHaveText('Step 1 of 3');
  expect(await figure.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
});

test('a journey selected before hydration survives checks, reload and home continuation', async ({
  page,
}) => {
  const release = await holdIslandCode(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('journeys/search/', { waitUntil: 'commit' });
  const next = page.getByRole('link', { name: 'Next: Latency and throughput' });
  await expect(next.locator('xpath=ancestor::astro-island[1]')).toHaveAttribute('ssr', '');
  await next.click({ noWaitAfter: true });
  await expect(page).toHaveURL(/concepts\/latency-throughput\/\?journey=search$/);
  release();
  await answerConcept(page, 'latency-throughput', false);
  await page.reload();
  const quiz = page.getByRole('region', { name: 'Quick check', exact: true });
  await island(quiz);
  await quiz.getByRole('button', { name: 'Practice again' }).click();
  await answerConcept(page, 'latency-throughput');
  await page.reload();
  await island(quiz);
  await expect(quiz).toContainText('Last check: 2 of 2');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('sdv:progress') ?? '{}').journey)).toBe(
    'search',
  );
  await page.goto('');
  await expect(
    page.locator('.sdv-hero').getByRole('link', { name: 'Continue: Availability' }),
  ).toHaveAttribute('href', /concepts\/availability\/\?journey=search$/);
});

test('manual steps seek within their own caption window instead of the final state', async ({ page }) => {
  await page.goto('concepts/load-balancer/');
  const figure = page.locator('figure.sdv-concept');
  const warning = figure.locator('[data-state="without"] .sdv-concept__show[data-show="0.46 1"]').first();
  await figure.getByRole('button', { name: 'Next step' }).click();
  await expect(figure.locator('[data-step-status]')).toHaveText('Step 1 of 3');
  await expect(warning).toHaveCSS('opacity', '0');
  for (const fill of await figure.locator('[data-state="without"] .sdv-concept__fill--bad').all()) {
    await expect(fill.locator('..')).toHaveCSS('opacity', '0');
  }
  await figure.getByRole('button', { name: 'Next step' }).click();
  await figure.getByRole('button', { name: 'Next step' }).click();
  await expect(warning).toHaveCSS('opacity', '1');
  await figure.getByRole('radio', { name: 'With', exact: true }).check();
  const failedServer = figure.locator('[data-state="with"] .sdv-concept__show[data-show="0.45 1"]');
  await figure.getByRole('button', { name: 'Next step' }).click();
  await expect(failedServer).toHaveCSS('opacity', '0');
  await figure.getByRole('button', { name: 'Next step' }).click();
  await expect(failedServer).toHaveCSS('opacity', '1');
});

test('search labels concepts, deeper lessons and scenarios', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const search = page.getByRole('textbox', { name: 'Search', exact: true });
  await search.fill('cache');
  await expect(
    page.locator('.pagefind-ui__result-title').filter({ hasText: 'Visual concept: Cache' }).first(),
  ).toBeVisible();
  await expect(
    page.locator('.pagefind-ui__result-title').filter({ hasText: 'Deeper lesson: Caching' }).first(),
  ).toBeVisible();
  await search.fill('search');
  await expect(
    page.locator('.pagefind-ui__result-title').filter({ hasText: 'Case study: Search' }).first(),
  ).toBeVisible();
});

test('guided journey fits narrow phones and passes accessibility checks', async ({ page }) => {
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('journeys/distributed-storage/');
    expect(await documentOverflow(page), `${width}px`).toBe(0);
  }
  const result = await new AxeBuilder({ page })
    .include('main')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(result.violations).toEqual([]);
});

test('a learning path ends in a case study and exposes decisions through keyboard disclosures', async ({
  page,
}) => {
  await page.goto('journeys/search/');
  const stages = page.locator('.sdv-path-stage');
  await expect(stages).toHaveCount(4);
  await expect(stages.last()).toContainText('Final case study');
  await expect(stages.last().getByRole('link', { name: 'Case study: Search', exact: true })).toHaveAttribute(
    'href',
    /case-studies\/search\/\?journey=search$/,
  );
  const decision = stages.nth(1).locator('.sdv-stage-details');
  await expect(decision).not.toHaveAttribute('open');
  await decision.locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(decision).toHaveAttribute('open', '');
  await expect(decision).toContainText('Decision:');
  await expect(decision).toContainText('Tradeoff:');
});

test('Scaling systems uses neutral navigation while preserving lesson and case-study URLs', async ({
  page,
  request,
}) => {
  await page.goto('scaling/load-balancing/');
  await expect(page.getByRole('heading', { level: 1, name: 'Load balancing' })).toBeVisible();
  await expect(page.locator('.sdv-lesson-head__module')).toHaveText('Module 2: Scaling systems');
  await expect(page.locator('.sdv-lesson-head__example')).toHaveCount(0);
  await expect(page.getByText('Worked example: a URL shortener.', { exact: true })).toBeVisible();
  await page.goto('curriculum/');
  await expect(page.locator('#map-scaling')).toHaveText('Module 2: Scaling systems');
  for (const [path, title] of [
    ['checkpoints/scaling/', 'Checkpoint 2: Scaling systems'],
    ['cheat-sheets/scaling/', 'Module summary: Scaling systems'],
    ['case-studies/shortener-at-scale/', 'Shortener at scale'],
    ['case-studies/shortener-bad-day/', 'Shortener bad day'],
  ] as const) {
    const response = await request.get(path);
    expect(response.status()).toBe(200);
    expect(await response.text()).toContain(title);
  }
});

test.describe('no JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('journeys and concept examples remain usable', async ({ page }) => {
    await page.goto('journeys/search/');
    await expect(page.getByRole('link', { name: 'Next: Latency and throughput' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Case study: Search', exact: true })).toBeVisible();
    await page.goto('concepts/load-balancer/');
    const figure = page.locator('figure.sdv-concept');
    await expect(figure.locator('.sdv-concept__steps')).toBeHidden();
    await figure.getByRole('radio', { name: 'With', exact: true }).check();
    await expect(figure.getByRole('img', { name: 'With a load balancer', exact: true })).toBeVisible();
    await page.locator('.sdv-concept-depth summary').click();
    await expect(page.locator('.sdv-concept-variants')).toBeVisible();
  });
});
