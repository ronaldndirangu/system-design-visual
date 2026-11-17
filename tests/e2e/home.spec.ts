import { expect, test } from '@playwright/test';
import { island } from './helpers';

test('home shows the load balancer picture and core concept cards in place of the routing challenge', async ({
  page,
}) => {
  await page.goto('');
  await expect(
    page.getByRole('region', { name: 'Three servers. Why are people still waiting?' }),
  ).toHaveCount(0);
  await expect(page.locator('.sdv-routing')).toHaveCount(0);

  const hero = page.locator('.sdv-hero');
  await expect(hero.getByRole('img', { name: 'Without a load balancer' })).toBeVisible();
  await expect(hero.getByRole('link', { name: 'How a load balancer works' })).toHaveAttribute(
    'href',
    /\/concepts\/load-balancer\/$/,
  );
  await expect(hero.getByRole('link', { name: 'Browse core concepts' })).toHaveAttribute(
    'href',
    /\/concepts\/$/,
  );

  const cards = page.getByRole('region', { name: 'Core concepts' }).locator('.sdv-concept-card');
  await expect(cards).toHaveCount(3);
  await expect(cards.first()).toHaveAttribute('href', /\/concepts\/load-balancer\/$/);
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
