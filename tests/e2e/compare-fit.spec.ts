import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { allLessons } from '../../src/data/curriculum';
import { documentOverflow, hydrateAll } from './helpers';

// Compare tables pack a label column and up to three value columns into a phone-width widget, so the narrowest
// supported screen checks every lesson that renders one. The built HTML tells which lessons do.
const distDir = fileURLToPath(new URL('../../dist/', import.meta.url));
const compareTable = /<table\b[^>]*\bclass="(?:[^"]*\s)?sdv-compare(?:\s[^"]*)?"/;

const comparePages = allLessons
  .map((lesson) => `${lesson.id}/`)
  .filter((path) => {
    const file = join(distDir, path, 'index.html');
    return existsSync(file) && compareTable.test(readFileSync(file, 'utf8'));
  });

const changedPages = new Set((process.env.E2E_PAGES ?? '').split(',').filter(Boolean));
const selectedPages =
  process.env.E2E_MODE === 'pr' ? comparePages.filter((path) => changedPages.has(path)) : comparePages;

test('the build contains lessons with compare tables', () => {
  expect(
    comparePages.length,
    `no compare tables found under ${distDir}; run pnpm build first`,
  ).toBeGreaterThan(0);
});

for (const path of selectedPages) {
  test(`${path} compare tables fit a 320px screen`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto(path);
    await hydrateAll(page);
    await expect(page.locator('table.sdv-compare').first()).toBeAttached();
    expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
  });
}
