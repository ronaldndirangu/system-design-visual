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
