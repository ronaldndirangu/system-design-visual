import { expect, test } from '@playwright/test';
import { island } from './helpers';

const roundRobin = 'Take turns (round robin)';
const leastConnections = 'Fewest unfinished (least connections)';

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

  const show = hero.getByRole('button', { name: 'Show result' });
  await show.click();
  await expect(panel).toContainText('turned away');
  await expect(panel).toContainText("C's turn came while it already held 4 unfinished requests");
  await show.click();
  await expect(panel).toContainText(
    'After 20 s: 173 arrived, 134 finished, 34 turned away, 5 still processing.',
  );
  await expect(hero.getByText('You called it: one queue overflowed.')).toBeVisible();
  await expect(show).toHaveAttribute('aria-disabled', 'true');

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

  await expect(fourth).toBeEnabled();
  await fourth.check();
  await expect(hero.locator('tr[data-row="round-robin@8/4"]')).toBeVisible();
  await expect(hero.locator('tr[data-row="least-connections@8/4"]')).toBeVisible();
  await rule.selectOption({ label: roundRobin });
  await show.click();
  await show.click();
  await expect(hero.locator('tr[data-row="round-robin@8/4"]')).toContainText('A 44, B 43, C 43, D 43');
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
