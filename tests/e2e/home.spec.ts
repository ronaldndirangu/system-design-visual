import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { concept, concepts } from '../../src/data/concepts';
import { foundations } from '../../src/data/journeys';
import { documentOverflow } from './helpers';

test('cold mobile home keeps initial JavaScript below 50 KB gzipped', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const scripts: Promise<Buffer>[] = [];
  page.on('response', (response) => {
    if (new URL(response.url()).pathname.endsWith('.js')) scripts.push(response.body());
  });
  await page.goto('', { waitUntil: 'networkidle' });
  const bodies = await Promise.all(scripts);
  expect(bodies.length).toBeGreaterThan(0);
  expect(bodies.reduce((total, body) => total + gzipSync(body).length, 0)).toBeLessThan(50_000);
});

test('home introduces the shared visual fundamentals before learning paths and deeper lessons', async ({
  page,
}) => {
  await page.goto('');
  await expect(
    page.getByRole('region', { name: 'Three servers. Why are people still waiting?' }),
  ).toHaveCount(0);
  await expect(page.locator('.sdv-routing')).toHaveCount(0);

  const hero = page.locator('.sdv-hero');
  await expect(hero.getByRole('link', { name: 'Start with fundamentals' })).toHaveAttribute(
    'href',
    /#learn-fundamentals$/,
  );
  await expect(hero.getByRole('link', { name: 'Explore learning paths' })).toHaveAttribute(
    'href',
    /\/journeys\/$/,
  );

  await expect(page.locator('.sdv-landing > h2')).toHaveText([
    'Learn the fundamentals',
    'Choose a system. Apply what you learned.',
    'Go deeper at your pace.',
  ]);
  const section = page.getByRole('region', { name: 'Learn the fundamentals' });
  await expect(section.locator('.sdv-concept-card__title')).toHaveText(
    foundations.concepts.map((slug) => concept(slug).title),
  );
  await expect(section.locator('.sdv-concept-card svg')).toHaveCount(3);
  for (const [index, slug] of foundations.concepts.entries()) {
    await expect(section.locator('.sdv-concept-card').nth(index)).toHaveAttribute(
      'href',
      `/system-design-visual/concepts/${slug}/`,
    );
  }
  await expect(
    section.getByRole('link', { name: `Explore all ${concepts.length} concepts` }),
  ).toHaveAttribute('href', /\/concepts\/$/);
  await expect(page.locator('.sdv-concept-index')).toHaveCount(0);
});

for (const width of [320, 390, 1440]) {
  test(`home fundamentals stay compact and ordered at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('');
    const section = page.getByRole('region', { name: 'Learn the fundamentals' });
    expect(await documentOverflow(page)).toBe(0);
    await expect(section.locator('svg')).toHaveCount(3);
    for (const link of await section.locator('.sdv-concept-card').all()) {
      const box = await link.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    const basics = await section.boundingBox();
    const paths = await page
      .getByRole('region', { name: 'Choose a system. Apply what you learned.' })
      .boundingBox();
    expect(basics?.height).toBeLessThan(800);
    expect((basics?.y ?? 0) + (basics?.height ?? 0)).toBeLessThan(paths?.y ?? 0);
  });
}

test('home offers distinct system journeys with keyboard-accessible entry points', async ({ page }) => {
  await page.goto('');
  const cards = page.locator('.sdv-system-grid');
  await expect(cards.getByRole('heading')).toHaveText([
    'Search engines',
    'Distributed systems: key-value storage',
    'Messaging and chat',
    'Social feeds',
  ]);
  const search = cards
    .locator('[data-journey="search"]')
    .getByRole('link', { name: 'Start learning path', exact: true });
  await search.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/journeys\/search\/$/);
  await expect(page.getByRole('region', { name: 'Your next step' })).toContainText('Stage 1 of 4');
});
