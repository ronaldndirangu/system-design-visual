import { expect, test } from '@playwright/test';

test('a click that lands before its island hydrates runs once after hydration', async ({ page }) => {
  let release: () => void = () => {};
  const islandCode = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/_astro/**/*.js', async (route) => {
    await islandCode;
    await route.continue();
  });

  await page.goto('scaling/caching/', { waitUntil: 'commit' });
  const diagram = page.getByRole('figure', { name: 'Cache-aside, step by step' });
  const island = page.locator('astro-island').filter({ has: diagram });
  const next = diagram.getByRole('button', { name: 'Next step' });

  await next.click();
  await next.click();
  await expect(island).toHaveAttribute('ssr', '');
  await expect(diagram.getByText(/^Step 1 of \d+$/)).toBeVisible();

  release();
  await expect(island).not.toHaveAttribute('ssr');
  await expect(diagram.getByText(/^Step 2 of \d+$/)).toBeVisible();

  await next.click();
  await expect(diagram.getByText(/^Step 3 of \d+$/)).toBeVisible();
});
