import { expect, test } from '@playwright/test';

const duelName = 'Simulation: Same clicks, with and without a CDN';

test('/scaling/cdn/ sits between caching and read replicas', async ({ page }) => {
  await page.goto('scaling/caching/');
  await page.locator('a[rel="next"]').click();
  await expect(page).toHaveURL(/\/scaling\/cdn\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'CDNs' })).toBeVisible();
  await expect(page.locator('.sdv-arc__stages [aria-current="step"]')).toContainText('CDN');
  await expect(page.locator('.sdv-arc svg[role="img"]')).toHaveAttribute('aria-label', /CDN edge/);

  await page.locator('a[rel="next"]').click();
  await expect(page).toHaveURL(/\/scaling\/read-replicas\/$/);
  await expect(page.locator('.sdv-arc__stages [aria-current="step"]')).toContainText('Read replicas');

  await page.locator('a[rel="prev"]').click();
  await expect(page).toHaveURL(/\/scaling\/cdn\/$/);
  await page.locator('a[rel="prev"]').click();
  await expect(page).toHaveURL(/\/scaling\/caching\/$/);
});

test('/scaling/cdn/ duel runs by keyboard and reports the pinned results', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('scaling/cdn/');
  const duel = page.getByRole('region', { name: duelName });
  await duel.scrollIntoViewIfNeeded();
  const skip = duel.getByRole('button', { name: 'Skip to the end' });
  await expect(skip).toBeEnabled();
  await expect(duel.getByText('Ready', { exact: true })).toBeVisible();

  await duel.getByRole('button', { name: 'Play', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(duel.getByText(/s of 20 s$/).first()).toBeVisible();

  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(duel.getByText('Run complete')).toBeVisible();
  const table = duel.getByRole('table').first();
  await expect(table.getByRole('row', { name: /Mean latency/ })).toContainText('28');
  await expect(table.getByRole('row', { name: /Requests reaching origin/ })).toContainText('1,402');
  await expect(table.getByRole('row', { name: /Clicks counted/ })).toContainText('35');
  await expect(
    duel.getByRole('table', { name: /by city/ }).getByRole('row', { name: /Sydney/ }),
  ).toContainText('473');
});

test('/scaling/cdn/ scenario chips reset the run and keep focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('scaling/cdn/');
  const duel = page.getByRole('region', { name: duelName });
  await duel.scrollIntoViewIfNeeded();
  const skip = duel.getByRole('button', { name: 'Skip to the end' });
  await expect(skip).toBeEnabled();
  await skip.click();
  await expect(duel.getByText('Run complete')).toBeVisible();

  await duel.getByRole('radio', { name: /Worldwide clicks/ }).focus();
  await page.keyboard.press('ArrowRight');
  const shortTtl = duel.getByRole('radio', { name: /Short TTL/ });
  await expect(shortTtl).toBeChecked();
  await expect(shortTtl).toBeFocused();
  await expect(duel.getByText('Ready', { exact: true })).toBeVisible();

  await duel.getByRole('radio', { name: /Origin shield/ }).check();
  await skip.click();
  const table = duel.getByRole('table').first();
  await expect(table.getByRole('row', { name: /Answered by the shield/ })).toBeVisible();
  await expect(table.getByRole('row', { name: /Requests reaching origin/ })).toContainText('683');
});

test('/scaling/cdn/ reflows at 320 px without page scroll', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('scaling/cdn/');
  const duel = page.getByRole('region', { name: duelName });
  await duel.scrollIntoViewIfNeeded();
  const skip = duel.getByRole('button', { name: 'Skip to the end' });
  await expect(skip).toBeEnabled();
  await skip.click();
  await expect(duel.getByText('Run complete')).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});
