import { expect, type Page, test } from '@playwright/test';
import { island } from './helpers';

/** Holds every island bundle until `release` runs, so the page stays server rendered meanwhile. */
async function holdIslandCode(page: Page): Promise<() => void> {
  let release: () => void = () => {};
  const islandCode = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/_astro/**/*.js', async (route) => {
    await islandCode;
    await route.continue();
  });
  return release;
}

test('every click that lands before its island hydrates applies in order', async ({ page }) => {
  const release = await holdIslandCode(page);
  await page.goto('scaling/caching/', { waitUntil: 'commit' });
  const diagram = page.getByRole('figure', { name: 'Cache-aside, step by step' });
  const root = page.locator('astro-island').filter({ has: diagram });
  const next = diagram.getByRole('button', { name: 'Next step' });

  await next.click();
  await next.click();
  await expect(root).toHaveAttribute('ssr', '');
  await expect(diagram.getByText(/^Step 1 of \d+$/)).toBeVisible();

  release();
  await island(diagram);
  await expect(diagram.getByText(/^Step 3 of \d+$/)).toBeVisible();

  await next.click();
  await expect(diagram.getByText(/^Step 4 of \d+$/)).toBeVisible();
});

test('an early answer and check replay into the quiz', async ({ page }) => {
  const release = await holdIslandCode(page);
  await page.goto('scaling/caching/', { waitUntil: 'commit' });
  const quiz = page.getByRole('region', { name: 'Check your understanding' });
  const item = quiz.locator('.sdv-quiz__item').first();
  const choice = item.locator('label.sdv-choice').first();

  await choice.click();
  await item.getByRole('button', { name: 'Check answer' }).click();
  await expect(item.getByRole('radio').first()).not.toBeChecked();

  release();
  await island(quiz);
  await expect(item.getByRole('radio').first()).toBeChecked();
  await expect(item.locator('.sdv-result')).toHaveText(/^(Correct|Not quite)$/);
});

test('early Step, Reset and Step clicks replay without merging', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const release = await holdIslandCode(page);
  await page.goto('scaling/load-balancing/', { waitUntil: 'commit' });
  const sim = page.getByRole('region', { name: 'Simulation: One server, one viral link' });
  const table = sim.getByRole('table');
  const press = async (name: 'Step' | 'Reset', times = 1) => {
    for (let i = 0; i < times; i += 1) await sim.getByRole('button', { name, exact: true }).click();
  };

  const header = sim.locator('.sdv-sim__header');
  const loading = () => header.evaluate((el) => getComputedStyle(el, '::after').content);
  expect(await loading()).toBe('"Loading interactive..."');
  await press('Step', 3);
  await press('Reset');
  await press('Step', 5);
  await expect(sim.getByText('Ready', { exact: true })).toBeVisible();

  release();
  await island(sim);
  await expect(sim.getByText('Ready', { exact: true })).toBeHidden();
  expect(await loading()).toBe('none');
  const replayed = await table.textContent();

  await press('Reset');
  await press('Step', 5);
  await expect.poll(() => table.textContent()).toBe(replayed);
  await press('Reset');
  await press('Step', 8);
  await expect.poll(() => table.textContent()).not.toBe(replayed);
});
