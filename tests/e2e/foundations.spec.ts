import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';

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

/** Axe the page as it stands after interaction, in both themes. */
async function expectAxeCleanInBothThemes(page: Page) {
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    expect(await axeViolations(page), theme).toEqual([]);
  }
}

async function openSimulation(page: Page, path: string, title: string): Promise<Locator> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(path);
  const sim = page.getByRole('region', { name: `Simulation: ${title}` });
  await sim.scrollIntoViewIfNeeded();
  await expect(sim.getByRole('button', { name: 'Skip to the end' })).toBeEnabled();
  return sim;
}

async function skipByKeyboard(page: Page, sim: Locator) {
  const skip = sim.getByRole('button', { name: 'Skip to the end' });
  await skip.focus();
  await page.keyboard.press('Enter');
  await expect(sim.getByText('Run complete', { exact: true })).toBeVisible();
}

/** Moves the scenario radio group one step with an arrow key and checks focus stays on the new chip. */
async function nextScenario(page: Page, sim: Locator, from: RegExp, to: RegExp) {
  await sim.getByRole('radio', { name: from }).focus();
  await page.keyboard.press('ArrowRight');
  const next = sim.getByRole('radio', { name: to });
  await expect(next).toBeChecked();
  await expect(next).toBeFocused();
  await expect(sim.getByText('Ready', { exact: true })).toBeVisible();
}

function cellsOf(sim: Locator, rowName: RegExp): Promise<string[]> {
  return sim.getByRole('row', { name: rowName }).getByRole('cell').allTextContents();
}

async function toggleByKeyboard(page: Page, scope: Locator, name: string, checked: boolean): Promise<void> {
  const toggle = scope.getByRole('switch', { name, exact: true });
  await expect(toggle).toBeEnabled();
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toBeChecked({ checked });
}

test('transactions: the duel replays pinned harm counts by keyboard', async ({ page }) => {
  const sim = await openSimulation(page, 'foundations/transactions/', 'Same requests, two ways to write');

  await skipByKeyboard(page, sim);
  await expect(sim.getByRole('row', { name: /^Clicks lost/ })).toContainText('13');
  await expect(sim.getByRole('row', { name: /^Clicks stored in the row/ })).toContainText('30');

  await nextScenario(page, sim, /Busy click counter/, /Three editors/);
  await skipByKeyboard(page, sim);
  await expect(sim.getByRole('row', { name: /^Edits erased without warning/ })).toContainText('7');

  await nextScenario(page, sim, /Three editors/, /Same custom alias/);
  await skipByKeyboard(page, sim);
  await expect(sim.getByRole('row', { name: /^Duplicate alias rows/ })).toContainText('10');

  await expectAxeCleanInBothThemes(page);
});

test('real-time: one minute of clicks matches the numbers the card quotes', async ({ page }) => {
  const sim = await openSimulation(
    page,
    'foundations/real-time/',
    'One minute of clicks, four ways to hear about them',
  );

  await sim.getByRole('button', { name: 'Step' }).click();
  await sim.getByRole('button', { name: 'Step' }).click();
  await expect(sim.getByText('1.0 s of 60 s', { exact: true })).toBeVisible();

  await skipByKeyboard(page, sim);
  expect(await cellsOf(sim, /^Requests sent/)).toEqual(['12', '7', '1', '1']);
  expect(await cellsOf(sim, /^Empty answers/)).toEqual(['10', '2', '0', '0']);
  expect(await cellsOf(sim, /^Worst lag/)).toEqual(['2.8 s', '0.1 s', '0.1 s', '0.1 s']);

  await nextScenario(page, sim, /Quiet link/, /Steady link/);
  await skipByKeyboard(page, sim);
  expect(await cellsOf(sim, /^Requests sent/)).toEqual(['12', '21', '1', '1']);

  await nextScenario(page, sim, /Steady link/, /Viral burst/);
  await skipByKeyboard(page, sim);
  expect(await cellsOf(sim, /^Worst lag/)).toEqual(['4.5 s', '0.2 s', '0.1 s', '0.1 s']);
  await expect(sim.getByText(/Click 19\./)).toBeVisible();

  await expectAxeCleanInBothThemes(page);
});

test('security: each missing defense lets through the pinned wrong requests', async ({ page }) => {
  const sim = await openSimulation(page, 'foundations/security/', 'Same requests, two sets of defenses');

  await skipByKeyboard(page, sim);
  expect(await cellsOf(sim, /^Requests arrived/)).toEqual(['33', '33']);
  expect(await cellsOf(sim, /^Wrongly allowed/)).toEqual(['10', expect.stringMatching(/^0/)]);
  expect(await cellsOf(sim, /^Still in flight/)).toEqual(['0', '0']);

  await nextScenario(page, sim, /No ownership check/, /Expired tokens accepted/);
  await skipByKeyboard(page, sim);
  expect(await cellsOf(sim, /^Wrongly allowed/)).toEqual(['10', expect.stringMatching(/^0/)]);

  await nextScenario(page, sim, /Expired tokens accepted/, /Plain HTTP/);
  await skipByKeyboard(page, sim);
  expect(await cellsOf(sim, /^Requests arrived/)).toEqual(['32', '32']);
  expect(await cellsOf(sim, /^Wrongly allowed/)).toEqual(['6', expect.stringMatching(/^0/)]);
  await expect(sim.getByText('Sessions a listener could copy: Ben')).toBeVisible();

  await nextScenario(page, sim, /Plain HTTP/, /Admin key in the repo/);
  await skipByKeyboard(page, sim);
  expect(await cellsOf(sim, /^Wrongly allowed/)).toEqual(['3', expect.stringMatching(/^0/)]);
  await expectAxeCleanInBothThemes(page);
});

test('data modeling: each query replays its pinned toy latency in every shape', async ({ page }) => {
  const sim = await openSimulation(page, 'foundations/data-modeling/', 'Same queries, three storage shapes');

  await skipByKeyboard(page, sim);
  expect(await cellsOf(sim, /^Toy latency/)).toEqual([
    expect.stringMatching(/^0\.51 ms/),
    expect.stringMatching(/^11\.8 ms/),
    expect.stringMatching(/^0\.51 ms/),
  ]);
  await expect(
    sim.getByText(
      'Run ends. Tables and Key-value tie for the redirect. At 20,000 a second, Documents would move 19.6 GB/s.',
    ),
  ).toBeVisible();

  await nextScenario(page, sim, /^Redirect/, /^Create a link/);
  await nextScenario(page, sim, /^Create a link/, /^Dashboard/);
  await skipByKeyboard(page, sim);
  expect(await cellsOf(sim, /^Toy latency/)).toEqual([
    expect.stringMatching(/^0\.89 ms/),
    expect.stringMatching(/^2\.0 ms/),
    expect.stringMatching(/^42\.8 ms/),
  ]);
  await expect(
    sim.getByText(
      'Run ends. Tables fits the dashboard best. At 50 a second, Key-value would move 49.1 MB/s.',
    ),
  ).toBeVisible();
  expect(await cellsOf(sim, /^Redirect/)).toEqual([
    expect.stringMatching(/^0\.51 ms/),
    expect.stringMatching(/^11\.8 ms/),
    expect.stringMatching(/^0\.51 ms/),
  ]);
  await expect(sim.getByRole('row', { name: /^Dashboard/ })).toHaveAttribute('data-current');

  await expectAxeCleanInBothThemes(page);
});

test('indexes: the scan falls behind the B-tree, and each index costs a write', async ({ page }) => {
  const sim = await openSimulation(page, 'foundations/indexes/', 'Same lookups, scan versus index');

  await nextScenario(page, sim, /^10 thousand links/, /^10 million links/);
  await skipByKeyboard(page, sim);
  expect(await cellsOf(sim, /^Answered/)).toEqual(['9', expect.stringMatching(/^43/)]);
  expect(await cellsOf(sim, /^Pages read so far/)).toEqual(['980,000', expect.stringMatching(/^172/)]);
  await expect(
    sim.getByText(
      'Run ends. 43 lookups arrived. The B-tree answered 43 and read 172 pages in total. The full scan answered 9 and read 980,000 pages.',
    ),
  ).toBeVisible();

  await nextScenario(page, sim, /^10 million links/, /^10 billion links/);
  await skipByKeyboard(page, sim);
  expect(await cellsOf(sim, /^Answered/)).toEqual(['0', expect.stringMatching(/^43/)]);
  expect(await cellsOf(sim, /^Pages read so far/)).toEqual(['980,000', expect.stringMatching(/^215/)]);

  const writes = page.getByRole('region', { name: 'Interactive: What one INSERT writes' });
  await writes.scrollIntoViewIfNeeded();
  await expect(writes.getByText('2 pages per insert', { exact: true })).toBeVisible();
  await toggleByKeyboard(page, writes, 'Index on (user_id)', true);
  await toggleByKeyboard(page, writes, 'Index on (user_id, created_at)', true);
  await expect(writes.getByText('One index is redundant', { exact: true })).toBeVisible();
  await expect(writes.getByRole('row', { name: /^Pages written per insert/ })).toContainText('4');
  await expect(writes.getByRole('row', { name: /^Redundant indexes/ })).toContainText('(user_id)');

  await toggleByKeyboard(page, writes, 'Index on UNIQUE (code)', false);
  await expect(writes.getByText('Redirects scan the table', { exact: true })).toBeVisible();

  await expectAxeCleanInBothThemes(page);
});
