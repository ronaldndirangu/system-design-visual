import { expect, type Locator, type Page, test } from '@playwright/test';

const lesson = 'scaling/caching/';
const title = 'Cache-aside, step by step';

async function openDiagram(page: Page): Promise<Locator> {
  await page.goto(lesson);
  const diagram = page.getByRole('figure', { name: title });
  await diagram.scrollIntoViewIfNeeded();
  await expect(page.locator('astro-island').filter({ has: diagram })).not.toHaveAttribute('ssr');
  return diagram;
}

/** Samples the flow dot twice; an animated dot changes position between samples. */
async function dotMoves(diagram: Locator): Promise<boolean> {
  const dot = diagram.locator('circle.sdv-dot').first();
  const before = await dot.getAttribute('cx');
  await diagram.page().waitForTimeout(250);
  const after = await dot.getAttribute('cx');
  return before !== after;
}

const button = (diagram: Locator, name: 'Pause' | 'Play') =>
  diagram.getByRole('button', { name, exact: true });

test('every step diagram on a lesson offers a pause control', async ({ page }) => {
  await page.goto(lesson);
  const diagrams = page.locator('figure.sdv-steps');
  await expect(diagrams.first()).toBeVisible();
  for (const diagram of await diagrams.all()) {
    await diagram.scrollIntoViewIfNeeded();
    await expect(button(diagram, 'Pause').or(button(diagram, 'Play'))).toBeVisible();
  }
});

test('autoplay rests within five seconds and Play resumes it', async ({ page }) => {
  const diagram = await openDiagram(page);
  await expect.poll(() => dotMoves(diagram)).toBe(true);

  await expect(button(diagram, 'Play')).toBeVisible({ timeout: 5000 });
  expect(await dotMoves(diagram)).toBe(false);

  await button(diagram, 'Play').click();
  await expect(button(diagram, 'Pause')).toBeVisible();
  await expect.poll(() => dotMoves(diagram)).toBe(true);
});

test('Pause stops the flow dot and stepping keeps it paused', async ({ page }) => {
  const diagram = await openDiagram(page);
  await button(diagram, 'Pause').click();
  await expect(button(diagram, 'Play')).toBeVisible();
  expect(await dotMoves(diagram)).toBe(false);

  await diagram.getByRole('button', { name: 'Next step' }).click();
  await expect(diagram.getByText(/^Step 2 of \d+$/)).toBeVisible();
  await expect(button(diagram, 'Play')).toBeVisible();
  expect(await dotMoves(diagram)).toBe(false);
});

test('reduced motion shows a static frame until the reader presses Play', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const diagram = await openDiagram(page);
  await expect(button(diagram, 'Play')).toBeVisible();
  expect(await dotMoves(diagram)).toBe(false);

  await button(diagram, 'Play').click();
  await expect.poll(() => dotMoves(diagram)).toBe(true);
  await button(diagram, 'Pause').click();
  expect(await dotMoves(diagram)).toBe(false);
});

test('the diagram announces each step once', async ({ page }) => {
  const diagram = await openDiagram(page);
  await expect(diagram.getByRole('img', { name: title, exact: true })).toBeVisible();
  await expect(diagram.locator('[aria-live]')).toHaveCount(1);
});
