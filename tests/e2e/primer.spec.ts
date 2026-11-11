import { expect, test } from '@playwright/test';

test('the write strategy duel shows write-behind losing writes when the cache crashes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('scaling/caching/');
  const duel = page.getByRole('region', { name: 'Simulation: Same writes, three cache strategies' });
  await duel.scrollIntoViewIfNeeded();
  await expect(duel.getByRole('radio', { name: /Count every click/ })).toBeChecked();

  const skip = duel.getByRole('button', { name: 'Skip to the end' });
  await expect(skip).toBeEnabled();
  await skip.click();
  await expect(duel.getByText('Run complete')).toBeVisible();
  await expect(duel.getByRole('row', { name: /Database writes/ })).toContainText('1319');

  const crash = duel.getByRole('radio', { name: /Cache crashes/ });
  await duel.getByRole('radio', { name: /Bulk import/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(crash).toBeChecked();
  await expect(crash).toBeFocused();
  await expect(duel.getByText('Ready', { exact: true })).toBeVisible();
  await expect(duel.getByText(/writes lost$/)).toHaveCount(0);

  await skip.click();
  await expect(duel.getByText('38 writes lost')).toBeVisible();
  await expect(duel.getByText(/Write-behind loses 38 writes/)).toBeVisible();
});

test('the write strategy duel plays and pauses', async ({ page }) => {
  await page.goto('scaling/caching/');
  const duel = page.getByRole('region', { name: 'Simulation: Same writes, three cache strategies' });
  await duel.scrollIntoViewIfNeeded();
  await expect(duel.getByRole('button', { name: 'Skip to the end' })).toBeEnabled();
  await duel.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(duel.getByText(/s of 20 s$/)).toBeVisible();
  await duel.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(duel.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
});

test('the load balancing lesson covers layers, proxies, and balancer failover', async ({ page }) => {
  await page.goto('scaling/load-balancing/');
  for (const name of ['Layer 4 or layer 7', 'Reverse proxies', 'Who balances the balancer?']) {
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('cell', { name: 'Active-active balancers' })).toBeVisible();
});
