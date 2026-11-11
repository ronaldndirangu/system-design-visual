import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    // Starlight's search button shows a "Ctrl K" hint (exposed via aria-keyshortcuts) that axe reads as label text.
    .exclude('button[data-open-modal]')
    .analyze();
  return results.violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id}: ${node.target.join(' ')} ${node.failureSummary}`),
  );
}

test('the convergence duel shows index edits diverging and CRDT ids converging', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.goto('case-studies/collaborative-editor/');
  const duel = page.getByRole('region', { name: 'Simulation: Two copies, two sync designs' });
  await duel.scrollIntoViewIfNeeded();
  const skip = duel.getByRole('button', { name: 'Skip to the end' });
  await expect(skip).toBeEnabled();

  await duel.getByRole('radio', { name: /Insert beside a delete/ }).check();
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(duel.getByRole('row', { name: /Ada's copy reads/ })).toContainText(/coat.*coat/);
  await expect(duel.getByRole('row', { name: /Ben's copy reads/ })).toContainText(/cost.*coat/);
  await expect(duel.locator('section[aria-label="CRDT ids"] .sdv-badge svg').first()).toHaveCSS(
    'width',
    /^1[0-9](\.\d+)?px$/,
  );
  expect(await axeViolations(page)).toEqual([]);
});

test('/case-studies/ride-sharing/ duels pin the distance checks for both lanes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('case-studies/ride-sharing/');

  const dense = page.getByRole('region', { name: 'Simulation: Same city, two ways to find a driver' });
  await dense.scrollIntoViewIfNeeded();
  const denseSkip = dense.getByRole('button', { name: 'Skip to the end' });
  await expect(denseSkip).toBeEnabled();
  await denseSkip.click();
  const denseTotal = dense.getByRole('row', { name: /Distance checks, total/ });
  await expect(denseTotal).toContainText('8,940');
  await expect(denseTotal).toContainText('646');
  await expect(dense.getByRole('row', { name: /Index updates/ })).toContainText('314');

  const edges = page.getByRole('region', { name: 'Simulation: Edges and empty suburbs' });
  await edges.scrollIntoViewIfNeeded();
  const edgeSkip = edges.getByRole('button', { name: 'Skip to the end' });
  await expect(edgeSkip).toBeEnabled();
  await edges.getByRole('radio', { name: /Rider near a cell edge/ }).check();
  await edgeSkip.focus();
  await page.keyboard.press('Enter');
  const edgeTotal = edges.getByRole('row', { name: /Distance checks, total/ });
  await expect(edgeTotal).toContainText('2,190');
  await expect(edgeTotal).toContainText('209');

  await edges.getByRole('radio', { name: /Sparse suburbs/ }).check();
  await edges.getByRole('button', { name: 'Skip to the end' }).click();
  const sparseTotal = edges.getByRole('row', { name: /Distance checks, total/ });
  await expect(sparseTotal).toContainText('240');
  await expect(sparseTotal).toContainText('33');
  await expect(edges.getByRole('row', { name: /Average match distance/ })).toContainText('993 m');
});

test('/case-studies/metrics/ widgets pin lost errors, rollup reads, and alert pages', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.goto('case-studies/metrics/');

  const duel = page.getByRole('region', { name: 'Simulation: One request stream, two label policies' });
  await duel.scrollIntoViewIfNeeded();
  const skip = duel.getByRole('button', { name: 'Skip to the end' });
  await expect(skip).toBeEnabled();
  await duel.getByRole('radio', { name: /^Launch day/ }).check();
  await skip.focus();
  await page.keyboard.press('Enter');
  const counted = duel.getByRole('row', { name: /Checkout 500s counted/ });
  await expect(counted).toContainText('3 of 45');
  await expect(counted).toContainText('45 of 45');
  await expect(duel.getByRole('row', { name: /Samples rejected/ })).toContainText('29,325');
  for (const lane of await duel.locator('.sdv-duel__lane').all()) {
    const laneBox = await lane.boundingBox();
    const badgeBox = await lane.locator('.sdv-badge').first().boundingBox();
    expect(laneBox && badgeBox && badgeBox.x + badgeBox.width <= laneBox.x + laneBox.width).toBe(true);
  }

  const tiers = page.getByRole('region', { name: 'Interactive: Which tier answers the dashboard' });
  await tiers.scrollIntoViewIfNeeded();
  await tiers.getByRole('radio', { name: '1 year' }).check();
  await expect(tiers.getByRole('row', { name: /Points read per series/ })).toContainText('8,760');
  await expect(tiers.getByRole('row', { name: /Tier that answers it/ })).toContainText('1 h rollups');

  const alert = page.getByRole('region', { name: 'Interactive: When does the alert page someone' });
  await alert.scrollIntoViewIfNeeded();
  await alert.getByRole('radio', { name: '2 min' }).check();
  await expect(alert.getByRole('row', { name: /False pages/ })).toContainText('0');
  await expect(alert.getByRole('row', { name: /Pages sent/ })).toContainText('at 8.5 min');
  expect(await axeViolations(page)).toEqual([]);
});

test('/case-studies/ride-sharing/ geohash explorer encodes the test point by keyboard', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.goto('case-studies/ride-sharing/');
  const explorer = page.getByRole('region', { name: 'Interactive: Geohash explorer' });
  await explorer.scrollIntoViewIfNeeded();
  const nextChar = explorer.getByRole('button', { name: 'Next character' });
  await expect(nextChar).toBeEnabled();

  await explorer.getByRole('radio', { name: 'Test point' }).check();
  while (await nextChar.isEnabled()) {
    await nextChar.focus();
    await page.keyboard.press('Enter');
  }
  await expect(explorer.getByRole('row', { name: /Hash so far/ })).toContainText('u4pruy');
  await expect(explorer.getByRole('row', { name: /Bits chosen/ })).toContainText('30 of 30');

  await explorer.getByRole('radio', { name: /North east of 0°, 0°/ }).check();
  await expect(explorer.getByRole('row', { name: /Hash so far/ })).toContainText('s00000');
  await explorer.getByRole('radio', { name: /South west of 0°, 0°/ }).check();
  await expect(explorer.getByRole('row', { name: /Hash so far/ })).toContainText('7zzzzz');
  expect(await axeViolations(page)).toEqual([]);
});
