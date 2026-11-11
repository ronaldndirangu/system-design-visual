import { expect, type Locator, type Page, test } from '@playwright/test';

async function openSim(page: Page, path: string, title: RegExp): Promise<Locator> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  const sim = page.getByRole('region', { name: title });
  await sim.scrollIntoViewIfNeeded();
  await expect(sim.getByRole('radio').first()).toBeEnabled();
  return sim;
}

async function runToEnd(sim: Locator) {
  await sim.getByRole('button', { name: 'Play' }).click();
  const skip = sim.getByRole('button', { name: 'Skip to the end' });
  await expect(skip).toBeEnabled();
  await skip.click();
  await expect(sim.getByText('Run complete')).toBeVisible();
}

function cells(sim: Locator, row: RegExp) {
  return sim.getByRole('row', { name: row }).getByRole('cell');
}

test.describe('/thinking/access-patterns/', () => {
  test('viral link overflows the hash only node and copies spread the load', async ({ page }) => {
    const sim = await openSim(page, 'thinking/access-patterns/', /^Simulation: One viral link/);
    await sim.getByRole('radio', { name: /^Viral link At 3 s/ }).check();
    await expect(sim.getByText('top key share 5% to 60%')).toBeVisible();
    await runToEnd(sim);

    const turnedAway = cells(sim, /^Turned away/);
    await expect(turnedAway.nth(0)).toHaveText('2049');
    await expect(turnedAway.nth(1)).toHaveText(/^6\s*Better$/);
    const peak = cells(sim, /^Busiest node, peak load/);
    await expect(peak.nth(0)).toHaveText('203%');
    await expect(peak.nth(1)).toHaveText(/^89%\s*Better$/);
  });

  test('scenario chips work from the keyboard and reset the run', async ({ page }) => {
    const sim = await openSim(page, 'thinking/access-patterns/', /^Simulation: One viral link/);
    const busy = sim.getByRole('radio', { name: /^Busy evening/ });
    await expect(busy).toBeChecked();
    await runToEnd(sim);
    await expect(cells(sim, /^Turned away/).nth(0)).toHaveText('0');

    await busy.focus();
    await page.keyboard.press('ArrowRight');
    await expect(sim.getByRole('radio', { name: /^Viral link At 3 s/ })).toBeChecked();
    await expect(sim.getByText('Ready', { exact: true })).toBeVisible();
    await expect(cells(sim, /^Clicks in/).nth(0)).toHaveText('0');
  });
});

test.describe('/thinking/slos/', () => {
  test('slow misses: the faster miss path keeps the SLO and budget', async ({ page }) => {
    const sim = await openSim(page, 'thinking/slos/', /^Simulation: Two fixes, one SLO/);
    await expect(sim.getByRole('radio', { name: /^Slow misses/ })).toBeChecked();
    await expect(cells(sim, /the SLI/).nth(0)).toHaveText('none yet');
    await runToEnd(sim);

    await expect(cells(sim, /^Redirects in/).nth(0)).toHaveText('19,921');
    const sli = cells(sim, /the SLI/);
    await expect(sli.nth(0)).toHaveText('97.5%');
    await expect(sli.nth(1)).toHaveText(/^99\.2%\s*Better$/);
    const budget = cells(sim, /^Error budget left/);
    await expect(budget.nth(0)).toHaveText('0 of 199');
    await expect(budget.nth(1)).toHaveText(/^41 of 199\s*Better$/);
    await expect(cells(sim, /^Mean/).nth(0)).toHaveText(/^27 ms\s*Better$/);
  });

  test('keyboard chip change resets and reruns the healthy baseline', async ({ page }) => {
    const sim = await openSim(page, 'thinking/slos/', /^Simulation: Two fixes, one SLO/);
    const slowMisses = sim.getByRole('radio', { name: /^Slow misses/ });
    await slowMisses.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(sim.getByRole('radio', { name: /^Healthy/ })).toBeChecked();
    await expect(cells(sim, /the SLI/).nth(0)).toHaveText('none yet');

    await runToEnd(sim);
    const sli = cells(sim, /the SLI/);
    await expect(sli.nth(0)).toHaveText('99.8%');
    await expect(sli.nth(1)).toHaveText(/^99\.9%/);
    await expect(cells(sim, /^Error budget left/).nth(0)).toHaveText('169 of 199');
  });
});
