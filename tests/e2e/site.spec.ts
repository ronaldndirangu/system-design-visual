import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { readyLessons } from '../../src/data/curriculum';

const pages = [
  { path: './', heading: /watching it break/i },
  { path: 'start-here/', heading: /How this course works/i },
  { path: 'curriculum/', heading: /Course map/i },
  { path: 'visual-language/', heading: /Visual language/i },
  { path: 'reference/', heading: /Reference sheet/i },
  ...readyLessons.map((lesson) => ({
    path: `${lesson.id}/`,
    heading: new RegExp(escapeRegExp(lesson.title), 'i'),
  })),
];

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

/** Scroll through the page so every client:visible island hydrates. */
async function hydrateAll(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += window.innerHeight / 2) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForLoadState('networkidle');
}

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // Starlight's search button shows a "Ctrl K" hint (exposed via aria-keyshortcuts) that axe reads as label text.
    .exclude('button[data-open-modal]')
    .analyze();
  return results.violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id}: ${node.target.join(' ')} ${node.failureSummary}`),
  );
}

for (const { path, heading } of pages) {
  for (const colorScheme of ['light', 'dark'] as const) {
    test(`${path} renders, hydrates, and passes axe in ${colorScheme} mode`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.emulateMedia({ colorScheme });
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      await hydrateAll(page);
      expect(errors).toEqual([]);
      expect(await axeViolations(page)).toEqual([]);
    });
  }
}

test('every page fits a phone screen without sideways scrolling', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  for (const { path } of pages) {
    await page.goto(path);
    await hydrateAll(page);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
});

test('every internal link stays under the base path and resolves', async ({ page, request }) => {
  const seen = new Set<string>();
  for (const { path } of pages.slice(0, 5)) {
    await page.goto(path);
    const hrefs = await page
      .locator('a[href^="/"]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
    for (const href of hrefs) seen.add(href.split('#')[0] ?? href);
  }
  for (const href of seen) {
    expect(href, href).toMatch(/^\/system-design-visual\//);
    const response = await request.get(href);
    expect(response.status(), href).toBe(200);
  }
});

test('the 404 page renders with working styles', async ({ page }) => {
  const response = await page.goto('does-not-exist/');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const stylesheet = page.locator('link[rel="stylesheet"]').first();
  await expect(stylesheet).toHaveAttribute('href', /^\/system-design-visual\//);
});

test('a quiz explains the chosen answer', async ({ page }) => {
  await page.goto('scaling/caching/');
  const quiz = page.getByRole('region', { name: 'Check your understanding' });
  await quiz.scrollIntoViewIfNeeded();
  const firstQuestion = quiz.getByRole('group').first();
  await firstQuestion.getByRole('radio').first().check();
  await quiz.getByRole('button', { name: 'Check answer' }).first().click();
  await expect(quiz.getByText(/Correct|Not quite/).first()).toBeVisible();
  await expect(quiz.getByText('1 of 3 answered')).toBeVisible();
});

test('a simulation steps forward and updates its readout', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('scaling/load-balancing/');
  const sim = page.getByRole('region', { name: /^Simulation:/ }).first();
  await sim.scrollIntoViewIfNeeded();
  const table = sim.getByRole('table');
  await expect(table).toBeVisible();
  const before = await table.textContent();
  for (let i = 0; i < 20; i += 1) await sim.getByRole('button', { name: 'Step' }).click();
  await expect.poll(async () => table.textContent()).not.toBe(before);
});

test('the balancer duel runs by keyboard and badges only clear winners', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.goto('scaling/load-balancing/');
  const duel = page.getByRole('region', { name: 'Simulation: Same traffic, two balancers' });
  await duel.scrollIntoViewIfNeeded();
  const skip = duel.getByRole('button', { name: 'Skip to the end' });
  const p95 = duel.getByRole('row', { name: /p95 latency/ });

  await expect(skip).toBeEnabled();
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(p95).toContainText('Better');
  expect(await axeViolations(page)).toEqual([]);

  await duel.getByRole('radio', { name: /Some slow requests/ }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(duel.getByRole('radio', { name: /Equal requests/ })).toBeChecked();
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(p95).toContainText('ms');
  await expect(duel.getByRole('table').last()).not.toContainText('Better');
});

test('switching the duel scenario mid run pauses it and keeps focus', async ({ page }) => {
  await page.goto('scaling/load-balancing/');
  const duel = page.getByRole('region', { name: 'Simulation: Same traffic, two balancers' });
  await duel.scrollIntoViewIfNeeded();
  await expect(duel.getByRole('button', { name: 'Skip to the end' })).toBeEnabled();

  await duel.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(duel.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await expect(duel.getByText(/s of 20 s$/)).toBeVisible();

  await duel.getByRole('radio', { name: /Some slow requests/ }).focus();
  await page.keyboard.press('ArrowLeft');
  const equal = duel.getByRole('radio', { name: /Equal requests/ });
  await expect(equal).toBeChecked();
  await expect(equal).toBeFocused();
  await expect(duel.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  await page.waitForTimeout(600);
  await expect(duel.getByText('Ready', { exact: true })).toBeVisible();
});

test('marking a lesson complete updates the course map', async ({ page }) => {
  await page.goto('thinking/requirements-and-estimates/');
  // The button hydrates on client:visible and stays disabled until then, so bring it into view first.
  const markComplete = page.getByRole('button', { name: 'Mark lesson complete' });
  await markComplete.scrollIntoViewIfNeeded();
  await markComplete.click();
  await expect(page.getByRole('button', { name: 'Completed' })).toBeVisible();
  await page.goto('curriculum/');
  const lesson = page.locator('[data-lesson-id="thinking/requirements-and-estimates"]');
  await expect(lesson).toHaveAttribute('data-complete', '');
  await expect(lesson.getByText('Completed')).toBeVisible();
});

test('the landing page offers a clear start', async ({ page }) => {
  await page.goto('./');
  const start = page.getByRole('link', { name: /Start learning/i }).first();
  await expect(start).toBeVisible();
  await start.click();
  await expect(page).toHaveURL(/\/system-design-visual\/(start-here|thinking)/);
});
