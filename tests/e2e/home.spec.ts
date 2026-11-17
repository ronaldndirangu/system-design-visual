import { expect, test } from '@playwright/test';
import { island } from './helpers';

const roundRobin = 'Take turns (round robin)';
const leastConnections = 'Fewest unfinished (least connections)';
const paused = 'Paused at the first rejection. Continue to see the full 20-second result.';
const phaseName = /^(Show result|Finish this run|Compare the same traffic)$/;

test('home hero waits for the reader, then replays both rules to the pinned results', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('');
  const hero = page.getByRole('region', { name: 'Three servers. Why are people still waiting?' });
  const panel = hero.getByTestId('routing-panel');
  const next = await island(hero.getByRole('button', { name: 'Next decision' }));
  await expect(next).toBeEnabled();
  await expect(panel).toContainText('Press Run or Next decision');
  await expect(hero.getByRole('button', { name: 'Run', exact: true })).toHaveCount(0);

  await hero.getByRole('radio', { name: /No, one queue overflows/ }).check();
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(panel).toContainText('Request 1 at');
  await expect(next).toBeFocused();

  const show = hero.getByRole('button', { name: phaseName });
  await expect(show).toHaveText('Show result');
  await show.click();
  await expect(panel).toContainText('turned away');
  await expect(panel).toContainText("C's turn came while it already held 4 unfinished requests");
  await expect(panel).toContainText(paused);
  await expect(show).toHaveText('Finish this run');
  await show.click();
  await expect(panel).toContainText(
    'After 20 s: 173 arrived, 134 finished, 34 turned away, 5 still processing.',
  );
  await expect(hero.getByText('You called it: one queue overflowed.')).toBeVisible();
  await expect(show).toHaveText('Compare the same traffic');
  await expect(show).not.toHaveAttribute('aria-disabled');

  const compact = hero.getByRole('list', { name: '173 arrivals over 20 seconds', exact: true });
  const rrCompact = compact.locator('li[data-compact="round-robin@8/3"]');
  const lcCompact = compact.locator('li[data-compact="least-connections@8/3"]');
  await expect(rrCompact).toHaveText(
    'Take turns: 134 finished, 34 turned away, 5 still processing. C chosen 57 times.',
  );
  await expect(lcCompact).toHaveText('Fewest unfinished: not finished yet.');
  const counts =
    ((await rrCompact.textContent()) ?? '').match(/\d+(?= (finished|turned away|still processing))/g) ?? [];
  expect(counts.map(Number).reduce((sum, value) => sum + value, 0)).toBe(173);

  const allCounts = hero.locator('details', { hasText: 'Inspect all counts' });
  await expect(allCounts).not.toHaveAttribute('open');
  await expect(allCounts.locator('table')).toBeHidden();
  await allCounts.locator('summary').click();

  const fourth = hero.getByRole('switch', { name: 'Add a fourth server (D, 5/s)' });
  await expect(fourth).toBeDisabled();
  const rr = hero.locator('tr[data-row="round-robin@8/3"]');
  const lc = hero.locator('tr[data-row="least-connections@8/3"]');
  await expect(rr).toContainText('A 58, B 58, C 57');
  await expect(lc).toContainText('Run to see');

  const rule = hero.getByRole('combobox', { name: 'Balancer rule' });
  await rule.selectOption({ label: leastConnections });
  await expect(panel).toContainText('Press Run or Next decision');
  await show.click();
  await expect(panel).toContainText(
    'After 20 s: 173 arrived, 171 finished, 0 turned away, 2 still processing.',
  );
  await expect(lc.getByRole('cell')).toHaveText([
    '8/s, 3 servers',
    '173',
    '171',
    '0',
    '2',
    'A 77, B 76, C 20',
  ]);
  await expect(lcCompact).toHaveText(
    'Fewest unfinished: 171 finished, 0 turned away, 2 still processing. C chosen 20 times.',
  );
  await expect(show).toHaveText('Show result');
  await expect(show).toHaveAttribute('aria-disabled', 'true');
  const explore = hero.getByTestId('routing-explore');
  await expect(explore).toContainText('Change the setup. Predict what happens next.');
  await expect(explore).toContainText('Current setup: 3 servers, 8 requests/s, Fewest unfinished.');
  await expect(hero.getByText('Each change resets the run to a paused start')).toBeVisible();

  await expect(fourth).toBeEnabled();
  await fourth.check();
  await expect(explore).toContainText('Current setup: 4 servers, 8 requests/s, Fewest unfinished.');
  await expect(hero.locator('tr[data-row="round-robin@8/4"]')).toBeVisible();
  await expect(hero.locator('tr[data-row="least-connections@8/4"]')).toBeVisible();
  await rule.selectOption({ label: roundRobin });
  await show.click();
  await expect(show).toHaveText('Finish this run');
  await show.click();
  await expect(hero.locator('tr[data-row="round-robin@8/4"]')).toContainText('A 44, B 43, C 43, D 43');
});

test('home hero compares the same traffic in either rule order', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const totals: Record<typeof roundRobin | typeof leastConnections, string> = {
    [roundRobin]: 'After 20 s: 173 arrived, 134 finished, 34 turned away, 5 still processing.',
    [leastConnections]: 'After 20 s: 173 arrived, 171 finished, 0 turned away, 2 still processing.',
  };
  const plain = (label: string) => label.split(' (')[0];
  for (const [first, second] of [
    [roundRobin, leastConnections],
    [leastConnections, roundRobin],
  ] as const) {
    await page.goto('');
    const hero = page.getByRole('region', { name: 'Three servers. Why are people still waiting?' });
    const panel = hero.getByTestId('routing-panel');
    const rule = hero.getByRole('combobox', { name: 'Balancer rule' });
    const phase = await island(hero.getByRole('button', { name: phaseName }));
    const runButton = hero.getByRole('button', { name: 'Run', exact: true });
    const next = hero.getByRole('button', { name: 'Next decision' });

    const play = async (label: keyof typeof totals) => {
      await runButton.click();
      if (label === roundRobin) {
        await expect(phase).toHaveText('Finish this run');
        await expect(panel).toContainText(paused);
      }
      await next.click();
      await expect(panel).toContainText('Request ');
      await expect(phase).toHaveText('Show result');
      await phase.click();
      await expect(panel).toContainText(totals[label]);
    };

    await rule.selectOption({ label: first });
    await hero.getByRole('radio', { name: /No, one queue overflows/ }).check();
    await play(first);

    await expect(phase).toHaveText('Compare the same traffic');
    await phase.focus();
    await page.keyboard.press('Enter');
    await expect(rule.locator('option:checked')).toHaveText(second);
    await expect(phase).toHaveText('Show result');
    await expect(phase).toBeFocused();
    const unobscured = await phase.evaluate((el) => {
      const rect = el.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return rect.top >= 0 && rect.bottom <= window.innerHeight && !!hit && el.contains(hit);
    });
    expect(unobscured).toBe(true);
    await expect(panel).toContainText('Press Run or Next decision');
    await expect(runButton).toBeVisible();

    await play(second);
    await expect(phase).toHaveAttribute('aria-disabled', 'true');
    const explore = hero.getByTestId('routing-explore');
    await expect(explore).toContainText(`Starting prediction: three servers, 8 requests/s, ${plain(first)}.`);
    await expect(explore).toContainText('Change the setup. Predict what happens next.');
    await expect(explore).toContainText(`Current setup: 3 servers, 8 requests/s, ${plain(second)}.`);
    await expect(hero.getByRole('radio')).toHaveCount(0);
  }
});

for (const width of [390, 320]) {
  test(`home hero keeps the explanation beside every queue at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 640 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('');
    const hero = page.getByRole('region', { name: 'Three servers. Why are people still waiting?' });
    await (await island(hero.getByRole('button', { name: 'Show result' }))).click();
    await expect(hero.getByTestId('routing-panel')).toContainText('turned away');

    const fit = await page.evaluate(async () => {
      const slots = () =>
        [...document.querySelectorAll('.sdv-routing__slots')].map((el) => el.getBoundingClientRect());
      window.scrollBy(0, Math.max(...slots().map((rect) => rect.bottom)) - window.innerHeight + 16);
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const dock = document.querySelector('.sdv-routing__dock')?.getBoundingClientRect();
      const panel = document.querySelector('[data-testid="routing-panel"]')?.getBoundingClientRect();
      const labels = [...document.querySelectorAll('.sdv-routing__svg text')].map(
        (el) => el.getBoundingClientRect().height,
      );
      return {
        queues: slots().filter(
          (rect) => rect.top >= (dock?.bottom ?? 0) - 1 && rect.bottom <= window.innerHeight + 1,
        ).length,
        panel: !!panel && panel.top >= 0 && panel.bottom <= window.innerHeight,
        smallestLabel: Math.min(...labels),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(fit.queues).toBe(3);
    expect(fit.panel).toBe(true);
    expect(fit.smallestLabel).toBeGreaterThanOrEqual(12);
    expect(fit.overflow).toBe(0);
  });
}

test('home hero controls reach 44px with a fine pointer', async ({ page }) => {
  await page.goto('');
  const hero = page.getByRole('region', { name: 'Three servers. Why are people still waiting?' });
  await island(hero.getByRole('button', { name: 'Run' }));
  expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches)).toBe(true);
  const small = await hero.evaluate((root) => {
    for (const details of root.querySelectorAll('details')) details.open = true;
    return [
      ...root.querySelectorAll<HTMLElement>(
        'button, select, summary, .sdv-choice, .sdv-toggle, input[type="range"]',
      ),
    ]
      .filter((el) => el.getClientRects().length > 0)
      .map((el) => ({ el, rect: el.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width < 43.5 || rect.height < 43.5)
      .map(
        ({ el, rect }) =>
          `${el.textContent?.trim().slice(0, 30)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
      );
  });
  expect(small).toEqual([]);
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('home hero lists every pinned result from the build', async ({ page }) => {
    await page.goto('');
    const hero = page.getByRole('region', { name: 'Three servers. Why are people still waiting?' });
    await expect(hero.getByTestId('routing-panel')).toContainText(
      'Both rules see the same 173 arrivals over 20 seconds.',
    );
    const results = hero.locator('details', { hasText: 'Results without animation' });
    await results.locator('summary').click();
    const rows = results.locator('tbody tr');
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0).getByRole('cell')).toHaveText([
      '3',
      '173',
      '134',
      '34',
      '3 s',
      'A 58, B 58, C 57',
    ]);
    await expect(rows.nth(1).getByRole('cell')).toHaveText([
      '3',
      '173',
      '171',
      '0',
      'Never',
      'A 77, B 76, C 20',
    ]);
    await expect(rows.nth(2).getByRole('cell').nth(3)).toHaveText('20');
  });
});

test('home journey stepper follows the tabs keyboard pattern', async ({ page }) => {
  await page.goto('');
  const tabs = page.getByRole('tablist', { name: 'Users' });
  const first = await island(tabs.getByRole('tab', { name: '100 users' }));
  await expect(first).toBeEnabled();
  await expect(first).toHaveAttribute('aria-selected', 'true');
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText('100 users: follow one click.');

  await first.focus();
  await page.keyboard.press('ArrowRight');
  const second = tabs.getByRole('tab', { name: '10K users' });
  await expect(second).toBeFocused();
  await expect(second).toHaveAttribute('aria-selected', 'true');
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText('10,000 users: the link goes viral.');

  await page.keyboard.press('End');
  const last = tabs.getByRole('tab', { name: '100M users' });
  await expect(last).toBeFocused();
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(
    '100 million users: distance and failure matter.',
  );
  await expect(panel.getByRole('img')).toHaveAttribute('aria-label', /Region 2/);

  await page.keyboard.press('Home');
  await expect(first).toBeFocused();
  await expect(first).toHaveAttribute('tabindex', '0');
  await expect(last).toHaveAttribute('tabindex', '-1');
});
