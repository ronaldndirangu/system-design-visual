import { expect, type Locator, type Page, test } from '@playwright/test';
import { concepts } from '../../src/data/concepts';
import { documentOverflow } from './helpers';

const lb = concepts[0];

/** Play states of the animations inside concept figures, ignoring page transitions elsewhere. */
function figureAnimations(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => {
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return target instanceof Element && target.closest('.sdv-concept') !== null;
      })
      .map((animation) => animation.playState),
  );
}

/** Smallest rendered SVG label in the locator, after the drawing's own scaling. */
function smallestLabel(scope: Locator): Promise<number> {
  return scope.evaluate((root) => {
    const sizes = [...root.querySelectorAll<SVGTextElement>('svg text')]
      .filter((text) => text.getClientRects().length > 0 && (text.textContent ?? '').trim())
      .map((text) => {
        const ctm = text.getScreenCTM();
        return Number.parseFloat(getComputedStyle(text).fontSize) * (ctm ? Math.hypot(ctm.a, ctm.b) : 1);
      });
    return Math.min(...sizes);
  });
}

for (const entry of concepts) {
  test(`${entry.slug} page shows its picture, variants, quick check and lesson link`, async ({ page }) => {
    await page.goto(`concepts/${entry.slug}/`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(entry.title);
    const figure = page.locator('figure.sdv-concept');
    await expect(figure).toHaveAttribute('data-ready', '');

    const without = figure.getByRole('img', { name: entry.states.without.title });
    const withIt = figure.getByRole('img', { name: entry.states.with.title });
    await expect(without).toBeVisible();
    await expect(withIt).toBeHidden();
    await expect(figure.locator('[data-state="without"] .sdv-concept__captions li')).toHaveText(
      entry.states.without.captions,
    );

    await figure.getByRole('radio', { name: 'With', exact: true }).check();
    await expect(withIt).toBeVisible();
    await expect(without).toBeHidden();
    await expect(figure.locator('[data-state="with"] .sdv-concept__captions li')).toHaveText(
      entry.states.with.captions,
    );

    await expect(page.locator('.sdv-concept-variants > li')).toHaveCount(entry.variants.length);
    await expect(page.getByRole('heading', { name: 'Quick check' })).toBeVisible();
    await expect(page.getByRole('link', { name: /^Go deeper:/ })).toHaveAttribute(
      'href',
      `/system-design-visual/${entry.lesson}/`,
    );
  });
}

test('concept figure plays three loops, then pauses, resumes, replays and rests on the final frame', async ({
  page,
}) => {
  await page.goto(`concepts/${lb.slug}/`);
  const figure = page.locator('figure.sdv-concept');
  const toggle = figure.locator('[data-action="toggle"]');
  const replay = figure.getByRole('button', { name: 'Replay animation' });
  await expect(toggle).toHaveAccessibleName('Pause animation');
  await expect(figure).toHaveAttribute('data-playing', '');
  expect(await figureAnimations(page)).toContain('running');
  const loops = await page.evaluate(() => document.getAnimations()[0]?.effect?.getTiming().iterations);
  expect(loops).toBe(3);

  await toggle.click();
  await expect(toggle).toHaveAccessibleName('Play animation');
  expect(new Set(await figureAnimations(page))).toEqual(new Set(['paused']));

  await toggle.click();
  await expect(toggle).toHaveAccessibleName('Pause animation');
  expect(await figureAnimations(page)).toContain('running');

  await figure.getByRole('radio', { name: 'With', exact: true }).check();
  await expect(figure).toHaveAttribute('data-playing', '');

  await page.evaluate(() => {
    for (const animation of document.getAnimations()) animation.finish();
  });
  await expect(figure).not.toHaveAttribute('data-playing');
  await expect(toggle).toHaveAccessibleName('Play animation');
  expect(await figureAnimations(page)).toEqual([]);

  await replay.click();
  await expect(figure).toHaveAttribute('data-playing', '');
  await expect(toggle).toHaveAccessibleName('Pause animation');
});

test('concept figure holds its animation while scrolled away', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto(`concepts/${lb.slug}/`);
  const figure = page.locator('figure.sdv-concept');
  await expect(figure).toHaveAttribute('data-playing', '');
  await page.getByRole('link', { name: /^Go deeper:/ }).scrollIntoViewIfNeeded();
  await expect.poll(async () => new Set(await figureAnimations(page))).toEqual(new Set(['paused']));
  await figure.scrollIntoViewIfNeeded();
  await expect.poll(() => figureAnimations(page)).toContain('running');
});

test('reduced motion shows the numbered storyboard without moving dots', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`concepts/${lb.slug}/`);
  const figure = page.locator('figure.sdv-concept');
  await expect(figure).toHaveAttribute('data-ready', '');
  expect(await figureAnimations(page)).toEqual([]);
  await expect(figure.locator('.sdv-concept__controls')).toBeHidden();
  const state = figure.locator('[data-state="without"]');
  await expect(state.locator('.sdv-concept__marker')).toHaveCount(3);
  await expect(state.locator('.sdv-concept__captions li')).toHaveCount(3);
  await expect(state.locator('.sdv-concept__captions li').first()).toHaveCSS('opacity', '1');
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });

  test('concept figure shows the static picture with captions and still toggles', async ({ page }) => {
    await page.goto(`concepts/${lb.slug}/`);
    const figure = page.locator('figure.sdv-concept');
    await expect(figure.getByRole('img', { name: lb.states.without.title })).toBeVisible();
    await expect(figure.locator('[data-state="without"] .sdv-concept__captions li')).toHaveCount(3);
    await expect(figure.locator('.sdv-concept__controls')).toBeHidden();
    await figure.getByRole('radio', { name: 'With', exact: true }).check();
    await expect(figure.getByRole('img', { name: lb.states.with.title })).toBeVisible();
  });
});

for (const width of [320, 390, 768, 1440]) {
  test(`concept pages fit ${width}px with readable labels and 44px controls`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    for (const entry of concepts) {
      await page.goto(`concepts/${entry.slug}/`);
      const figure = page.locator('figure.sdv-concept');
      await expect(figure).toHaveAttribute('data-ready', '');
      expect(await documentOverflow(page), `${entry.slug} overflow`).toBe(0);
      expect(await smallestLabel(page.locator('main')), `${entry.slug} without`).toBeGreaterThanOrEqual(11.9);
      await figure.getByRole('radio', { name: 'With', exact: true }).check();
      expect(await documentOverflow(page), `${entry.slug} overflow`).toBe(0);
      expect(await smallestLabel(page.locator('main')), `${entry.slug} with`).toBeGreaterThanOrEqual(11.9);
      for (const button of await figure.getByRole('button').all()) {
        const box = await button.boundingBox();
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(43.5);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(43.5);
      }
    }
  });
}

test('concepts index lists each shipped concept with credit to the primer', async ({ page }) => {
  await page.goto('concepts/');
  const cards = page.locator('.sdv-concept-card');
  await expect(cards).toHaveCount(concepts.length);
  for (const [i, entry] of concepts.entries()) {
    await expect(cards.nth(i)).toHaveAttribute('href', `/system-design-visual/concepts/${entry.slug}/`);
    await expect(cards.nth(i)).toContainText(entry.definition);
  }
  await expect(page.getByRole('link', { name: /System Design Primer/ })).toHaveAttribute(
    'href',
    /github\.com\/donnemartin\/system-design-primer/,
  );
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'All concepts' }),
  ).toBeVisible();
});
