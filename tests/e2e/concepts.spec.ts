import { expect, type Locator, type Page, test } from '@playwright/test';
import { CAPTION_COUNT, CONCEPT_COPY, conceptGroups, concepts } from '../../src/data/concepts';
import { course, courses } from '../../src/data/courses';
import { documentOverflow } from './helpers';

/** Play states of the scripted animations inside concept figures, ignoring CSS transitions. */
function figureAnimations(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => {
        if (animation instanceof CSSTransition || animation instanceof CSSAnimation) return false;
        const target = (animation.effect as KeyframeEffect | null)?.target;
        return target instanceof Element && target.closest('.sdv-concept') !== null;
      })
      .map((animation) => animation.playState),
  );
}

/** Iteration counts of the scripted figure animations. */
function figureLoops(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    document
      .getAnimations()
      .filter((animation) => !(animation instanceof CSSTransition || animation instanceof CSSAnimation))
      .map((animation) => Number(animation.effect?.getTiming().iterations)),
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

const states = ['without', 'with'] as const;

for (const entry of concepts) {
  const path = `concepts/${entry.slug}/`;

  test.describe(entry.slug, () => {
    test('page shows the template in order with both pictures', async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(entry.title);
      await expect(page.locator('.sdv-concept-lead')).toHaveText(entry.definition);
      await expect(page.locator('.sdv-concept-analogy')).toHaveText(
        `${CONCEPT_COPY.analogy} ${entry.analogy}`,
      );

      const figure = page.locator('figure.sdv-concept');
      await expect(figure).toHaveAttribute('data-ready', '');
      const without = figure.getByRole('img', { name: entry.states.without.title });
      const withIt = figure.getByRole('img', { name: entry.states.with.title });
      await expect(without).toBeVisible();
      await expect(withIt).toBeHidden();
      await expect(figure.locator('[data-state="without"] .sdv-concept__captions li')).toHaveText(
        entry.states.without.captions,
      );
      await figure.getByRole('radio', { name: entry.states.with.label, exact: true }).check();
      await expect(withIt).toBeVisible();
      await expect(without).toBeHidden();
      await expect(figure.locator('[data-state="with"] .sdv-concept__captions li')).toHaveText(
        entry.states.with.captions,
      );

      await expect(page.locator('.sdv-concept-steps > li')).toHaveText(entry.steps);
      await expect(page.locator('.sdv-concept-variants > li')).toHaveCount(entry.variants.length);
      await expect(page.locator('.sdv-concept-example')).toContainText(entry.example.title);
      await expect(page.locator('.sdv-concept-bullets > li')).toHaveText([
        `${CONCEPT_COPY.useWhen} ${entry.tradeoffs.useWhen}`,
        `${CONCEPT_COPY.costs} ${entry.tradeoffs.costs}`,
        `${CONCEPT_COPY.realExample} ${entry.tradeoffs.realExample}`,
        `${CONCEPT_COPY.watchOut} ${entry.tradeoffs.watchOut}`,
      ]);
      await expect(page.getByRole('heading', { name: CONCEPT_COPY.quiz })).toBeVisible();
      for (const question of entry.quiz) await expect(page.getByText(question.prompt)).toBeVisible();
      if (entry.lesson) {
        await expect(page.getByRole('link', { name: /^Go deeper:/ })).toHaveAttribute(
          'href',
          `/system-design-visual/${entry.lesson}/`,
        );
      }
      const links = page.locator('.sdv-concept-links a');
      await expect(links).toHaveText(
        entry.learnMore.map((link) => `${course(link.course).name}: ${link.label}`),
      );
      for (const [i, link] of entry.learnMore.entries()) {
        await expect(links.nth(i)).toHaveAttribute('href', link.href);
      }
    });

    test('player pauses, resumes, replays and rests on the final frame', async ({ page }) => {
      await page.goto(path);
      const figure = page.locator('figure.sdv-concept');
      const toggle = figure.locator('[data-action="toggle"]');
      const replay = figure.getByRole('button', { name: 'Replay animation' });
      await expect(toggle).toHaveAccessibleName('Pause animation');
      await expect(figure).toHaveAttribute('data-playing', '');
      expect(await figureAnimations(page)).toContain('running');
      expect(new Set(await figureLoops(page))).toEqual(new Set([3]));

      await toggle.click();
      await expect(toggle).toHaveAccessibleName('Play animation');
      expect(new Set(await figureAnimations(page))).toEqual(new Set(['paused']));

      await toggle.click();
      await expect(toggle).toHaveAccessibleName('Pause animation');
      expect(await figureAnimations(page)).toContain('running');

      await figure.getByRole('radio', { name: entry.states.with.label, exact: true }).check();
      await expect(figure).toHaveAttribute('data-playing', '');

      await page.evaluate(() => {
        for (const animation of document.getAnimations()) animation.finish();
      });
      await expect(figure).not.toHaveAttribute('data-playing');
      await expect(toggle).toHaveAccessibleName('Play animation');
      expect(await figureAnimations(page)).toEqual([]);
      const rest = figure.locator('[data-state="with"]');
      await expect(rest.locator('.sdv-concept__marker')).toHaveCount(CAPTION_COUNT);
      for (const caption of await rest.locator('.sdv-concept__captions li').all()) {
        await expect(caption).toHaveCSS('opacity', '1');
      }

      await replay.click();
      await expect(figure).toHaveAttribute('data-playing', '');
      await expect(toggle).toHaveAccessibleName('Pause animation');
    });

    test('reduced motion shows the numbered storyboard without moving parts', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(path);
      const figure = page.locator('figure.sdv-concept');
      await expect(figure).toHaveAttribute('data-ready', '');
      expect(await figureAnimations(page)).toEqual([]);
      await expect(figure.locator('.sdv-concept__controls')).toBeHidden();
      for (const state of states) {
        await figure.getByRole('radio', { name: entry.states[state].label, exact: true }).check();
        const root = figure.locator(`[data-state="${state}"]`);
        await expect(root.locator('.sdv-concept__marker')).toHaveCount(CAPTION_COUNT);
        const captions = root.locator('.sdv-concept__captions li');
        await expect(captions).toHaveCount(CAPTION_COUNT);
        for (const caption of await captions.all()) await expect(caption).toHaveCSS('opacity', '1');
      }
      expect(await figureAnimations(page)).toEqual([]);
    });

    test('fits 320, 390, 768 and 1440px with readable labels and 44px controls', async ({ page }) => {
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(path);
        const figure = page.locator('figure.sdv-concept');
        await expect(figure).toHaveAttribute('data-ready', '');
        expect(await documentOverflow(page), `${width}px overflow`).toBe(0);
        expect(await smallestLabel(page.locator('main')), `${width}px without`).toBeGreaterThanOrEqual(11.9);
        await figure.getByRole('radio', { name: entry.states.with.label, exact: true }).check();
        expect(await documentOverflow(page), `${width}px overflow`).toBe(0);
        expect(await smallestLabel(page.locator('main')), `${width}px with`).toBeGreaterThanOrEqual(11.9);
        for (const button of await figure.getByRole('button').all()) {
          const box = await button.boundingBox();
          expect(box?.width ?? 0, `${width}px control width`).toBeGreaterThanOrEqual(43.5);
          expect(box?.height ?? 0, `${width}px control height`).toBeGreaterThanOrEqual(43.5);
        }
      }
    });
    test.describe('without JavaScript', () => {
      test.use({ javaScriptEnabled: false });

      test('shows the final frame with captions, hides the controls and still toggles', async ({ page }) => {
        await page.goto(path);
        const figure = page.locator('figure.sdv-concept');
        await expect(figure.locator('.sdv-concept__controls')).toHaveCSS('display', 'none');
        for (const state of states) {
          await figure.getByRole('radio', { name: entry.states[state].label, exact: true }).check();
          await expect(figure.getByRole('img', { name: entry.states[state].title })).toBeVisible();
          const captions = figure.locator(`[data-state="${state}"] .sdv-concept__captions li`);
          await expect(captions).toHaveText(entry.states[state].captions);
          for (const caption of await captions.all()) await expect(caption).toHaveCSS('opacity', '1');
        }
      });
    });
  });
}

test('concept figure holds its animation while scrolled away', async ({ page }) => {
  const [first] = concepts;
  test.skip(!first, 'no concepts registered');
  await page.setViewportSize({ width: 390, height: 640 });
  await page.goto(`concepts/${first?.slug}/`);
  const figure = page.locator('figure.sdv-concept');
  await expect(figure).toHaveAttribute('data-playing', '');
  await page.getByRole('heading', { name: CONCEPT_COPY.learnMore }).scrollIntoViewIfNeeded();
  await expect.poll(async () => new Set(await figureAnimations(page))).toEqual(new Set(['paused']));
  await figure.scrollIntoViewIfNeeded();
  await expect.poll(() => figureAnimations(page)).toContain('running');
});

test('concepts index groups every concept and lists the courses to keep learning', async ({ page }) => {
  await page.goto('concepts/');
  await expect(page.getByText(/Topic list inspired/)).toHaveCount(0);
  const groups = page.locator('.sdv-concept-cards__group');
  await expect(groups.locator('.sdv-concept-cards__title')).toHaveText(
    conceptGroups().map((group) => group.title),
  );
  for (const [i, group] of conceptGroups().entries()) {
    const cards = groups.nth(i).locator('.sdv-concept-card');
    await expect(cards).toHaveCount(group.concepts.length);
    for (const [j, entry] of group.concepts.entries()) {
      await expect(cards.nth(j)).toHaveAttribute('href', `/system-design-visual/concepts/${entry.slug}/`);
      await expect(cards.nth(j)).toContainText(entry.title);
      await expect(cards.nth(j)).toContainText(entry.definition);
    }
  }
  expect(await documentOverflow(page)).toBe(0);

  await expect(page.getByRole('heading', { level: 2, name: 'Keep learning' })).toBeVisible();
  const list = page.locator('.sdv-course-list');
  for (const entry of courses) {
    await expect(list.getByRole('link', { name: entry.name, exact: true })).toHaveAttribute(
      'href',
      entry.url,
    );
    for (const link of entry.links ?? []) {
      await expect(list.getByRole('link', { name: link.label, exact: true })).toHaveAttribute(
        'href',
        link.url,
      );
    }
  }
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'All concepts' }),
  ).toBeVisible();
});

test('sidebar nests each concept under its group in order', async ({ page }) => {
  await page.goto('concepts/');
  const nav = page.getByRole('navigation', { name: 'Main' });
  for (const group of conceptGroups()) {
    for (const entry of group.concepts) {
      await expect(nav.getByRole('link', { name: entry.title, exact: true })).toHaveAttribute(
        'href',
        `/system-design-visual/concepts/${entry.slug}/`,
      );
    }
  }
  const labels = await nav.locator('summary').allInnerTexts();
  const titles = conceptGroups().map((group) => group.title);
  expect(labels.map((label) => label.trim()).filter((label) => titles.includes(label))).toEqual(titles);
});
