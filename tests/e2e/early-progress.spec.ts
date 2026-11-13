import { expect, type Page, test } from '@playwright/test';
import { holdIslandCode, island } from './helpers';

function completedLessons(page: Page): Promise<number> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('sdv:progress');
    const lessons: Record<string, { completedAt?: string }> = raw ? (JSON.parse(raw).lessons ?? {}) : {};
    return Object.values(lessons).filter((lesson) => lesson.completedAt).length;
  });
}

test('a Mark complete tap before hydration completes the lesson once', async ({ page }) => {
  const release = await holdIslandCode(page);
  await page.goto('scaling/caching/', { waitUntil: 'commit' });
  // The heading, and so the region name, changes once the lesson completes.
  const section = page.locator('section[aria-labelledby="sdv-complete-title"]');
  const root = page.locator('astro-island').filter({ has: section });

  await section.getByRole('button', { name: 'Mark lesson complete' }).click();
  await expect(root).toHaveAttribute('ssr', '');

  release();
  await island(section.getByRole('button'));
  await expect(section.getByRole('button', { name: 'Completed' })).toBeVisible();
  await expect.poll(() => completedLessons(page)).toBe(1);
});

test('an Export tap before hydration downloads one file', async ({ page }) => {
  const release = await holdIslandCode(page);
  await page.goto('start-here/', { waitUntil: 'commit' });
  const exportButton = page.getByRole('button', { name: 'Export progress' });
  const downloads: string[] = [];
  page.on('download', (download) => downloads.push(download.suggestedFilename()));

  await exportButton.click();
  await expect(page.locator('astro-island').filter({ has: exportButton })).toHaveAttribute('ssr', '');

  const download = page.waitForEvent('download');
  release();
  await island(exportButton);
  expect((await download).suggestedFilename()).toBe('sdv-progress.json');
  expect(downloads).toHaveLength(1);
});

test('Continue follows the core path and sits beside Review', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('sdv:progress')) return;
    localStorage.setItem(
      'sdv:progress',
      JSON.stringify({
        version: 3,
        last: 'foundations/unique-ids',
        lessons: { 'foundations/unique-ids': { completedAt: '2026-01-05T00:00:00.000Z' } },
      }),
    );
  });
  await page.goto('start-here/');
  const root = page.locator('main .sdv-continue');
  const next = root.getByRole('link', { name: /^Continue:/ });
  await expect(next).toHaveText('Continue: Real-time transport');
  await expect(next).toHaveAttribute('href', /\/foundations\/real-time\/$/);
  await expect(root.getByRole('link', { name: 'Review', exact: true })).toHaveAttribute(
    'href',
    /\/review\/$/,
  );
});

test.describe('phone menu', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('opens on the current module with the others collapsed', async ({ page }) => {
    await page.goto('foundations/unique-ids/');
    await page.getByRole('button', { name: 'Menu' }).click();
    const sidebar = page.locator('#starlight__sidebar');
    const group = (label: string) =>
      sidebar.locator('details').filter({ has: page.locator('summary', { hasText: label }) });

    await expect(group('1. Foundations')).toHaveAttribute('open', '');
    await expect(sidebar.getByRole('link', { name: 'Unique IDs' })).toHaveAttribute('aria-current', 'page');
    const reliability = group('3. Reliability');
    await expect(reliability).not.toHaveAttribute('open');

    await reliability.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(reliability).toHaveAttribute('open', '');
    await page.keyboard.press('Enter');
    await expect(reliability).not.toHaveAttribute('open');
  });
});
