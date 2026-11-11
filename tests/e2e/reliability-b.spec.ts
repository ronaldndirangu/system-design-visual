import { expect, type Page, test } from '@playwright/test';

async function openSim(page: Page, path: string, name: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  const sim = page.getByRole('region', { name: `Simulation: ${name}` });
  await sim.scrollIntoViewIfNeeded();
  const skip = sim.getByRole('button', { name: 'Skip to the end' });
  await expect(skip).toBeEnabled();
  return { sim, skip };
}

test.describe('/reliability/rate-limiting/', () => {
  const noisyName = 'One noisy client, with and without a limit';

  test('noisy neighbor duel runs by keyboard and reports the pinned results', async ({ page }) => {
    const { sim, skip } = await openSim(page, 'reliability/rate-limiting/', noisyName);
    await expect(sim.getByText('Ready', { exact: true })).toBeVisible();

    await sim.getByRole('button', { name: 'Play', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(sim.getByText(/s of 20 s$/).first()).toBeVisible();

    await skip.focus();
    await page.keyboard.press('Enter');
    await expect(sim.getByText('Run complete', { exact: true })).toBeVisible();
    const table = sim.getByRole('table').first();
    const served = table.getByRole('row', { name: /Polite clients served/ });
    await expect(served).toContainText('2,001 (67%)');
    await expect(served).toContainText('2,992 (100%)');
    await expect(table.getByRole('row', { name: /Polite requests shed with 503/ })).toContainText('983');
    await expect(table.getByRole('row', { name: /Client A requests that got 429/ })).toContainText('4,450');
  });

  test('scenario chips reset the run, keep focus, and the calm chip ties', async ({ page }) => {
    const { sim, skip } = await openSim(page, 'reliability/rate-limiting/', noisyName);
    await skip.click();
    await expect(sim.getByText('Run complete', { exact: true })).toBeVisible();

    await sim.getByRole('radio', { name: /Noisy neighbor/ }).focus();
    await page.keyboard.press('ArrowRight');
    const calm = sim.getByRole('radio', { name: /Calm traffic/ });
    await expect(calm).toBeChecked();
    await expect(calm).toBeFocused();
    await expect(sim.getByText('Ready', { exact: true })).toBeVisible();

    await skip.click();
    const row = sim
      .getByRole('table')
      .first()
      .getByRole('row', { name: /^Served/ });
    await expect(row.getByRole('cell')).toContainText(['4,085', '4,085']);
  });

  test('window duel shows the boundary burst', async ({ page }) => {
    const { sim, skip } = await openSim(page, 'reliability/rate-limiting/', 'Fixed window or sliding window');
    await skip.click();
    await expect(sim.getByText('Run complete', { exact: true })).toBeVisible();
    const peak = sim
      .getByRole('table')
      .first()
      .getByRole('row', { name: /Busiest second/ });
    await expect(peak.getByRole('cell')).toContainText(['295', '195']);
  });

  test('retry duel shows Retry-After beating instant retries', async ({ page }) => {
    const { sim, skip } = await openSim(page, 'reliability/rate-limiting/', 'Two clients meet a 429');
    await skip.click();
    await expect(sim.getByText('Run complete', { exact: true })).toBeVisible();
    const gaveUp = sim
      .getByRole('table')
      .first()
      .getByRole('row', { name: /Gave up after 3 retries/ });
    await expect(gaveUp.getByRole('cell')).toContainText(['181', '32']);
  });

  test('token bucket playground drains on a burst and reacts to the refill slider', async ({ page }) => {
    const { sim, skip } = await openSim(page, 'reliability/rate-limiting/', 'Token bucket playground');
    await expect(sim.getByRole('radio', { name: /Burst/ })).toBeChecked();
    await skip.click();
    await expect(sim.getByText('Run complete', { exact: true })).toBeVisible();
    await expect(sim).toContainText('93 of 115 requests served, 22 got 429');

    await sim.getByRole('button', { name: 'Reset' }).click();
    await expect(sim.getByText('Ready', { exact: true })).toBeVisible();
    const refill = sim.getByRole('slider', { name: /Refill rate/ });
    await refill.focus();
    for (let i = 0; i < 20; i += 1) await page.keyboard.press('ArrowRight');
    await expect(refill).toHaveValue('20');
    await skip.click();
    await expect(sim).toContainText('111 of 115 requests served, 4 got 429');
  });

  test('reflows at 320 px without page scroll', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const { sim, skip } = await openSim(page, 'reliability/rate-limiting/', noisyName);
    await skip.click();
    await expect(sim.getByText('Run complete', { exact: true })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
