import { expect, type Page, test } from '@playwright/test';

async function openEstimator(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('thinking/requirements-and-estimates/');
  const sim = page.getByRole('region', { name: /^Interactive: Size the URL shortener/ });
  await sim.scrollIntoViewIfNeeded();
  await expect(sim.getByRole('slider').first()).toBeEnabled();
  return sim;
}

async function smallestSvgFontPx(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((texts) =>
    Math.min(
      ...texts.map((text) => {
        const svg = (text as SVGTextElement).ownerSVGElement;
        const scale = svg ? svg.getBoundingClientRect().width / svg.viewBox.baseVal.width : 1;
        return Number.parseFloat(getComputedStyle(text).fontSize) * scale;
      }),
    ),
  );
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe('touch targets', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('buttons and stepper controls are at least 44px on coarse pointers', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('reliability/rate-limiting/');
    const buttons = page.locator('.sdv-sim .sdv-button:visible');
    await expect(buttons.first()).toBeVisible();
    const sizes = await buttons.evaluateAll((elements) =>
      elements.map((element) => {
        const box = element.getBoundingClientRect();
        return Math.min(box.width, box.height);
      }),
    );
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(44);
  });
});

test.describe('estimator readability', () => {
  for (const width of [390, 1440]) {
    test(`chart text renders at 12px or more at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const sim = await openEstimator(page);
      await expect(sim.locator('svg[role="img"]').first()).toBeVisible();
      expect(await smallestSvgFontPx(page, '.sdv-estimator svg text')).toBeGreaterThanOrEqual(12);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test('the scale control is a select on narrow screens and radios on wide ones', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    let sim = await openEstimator(page);
    const select = sim.getByRole('combobox', { name: 'Scale' });
    await expect(select).toBeVisible();
    await expect(sim.getByRole('group', { name: 'Scale' })).toBeHidden();
    await select.selectOption({ label: 'Planet scale' });
    await expect(select).toHaveValue('planet');

    await page.setViewportSize({ width: 1440, height: 900 });
    sim = await openEstimator(page);
    await expect(sim.getByRole('group', { name: 'Scale' })).toBeVisible();
    await expect(sim.getByRole('combobox', { name: 'Scale' })).toBeHidden();
  });

  test('the axis grows past one million requests per second instead of clamping', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const sim = await openEstimator(page);
    for (const name of ['New links per day', 'Clicks per link']) {
      const slider = sim.getByRole('slider', { name });
      await slider.focus();
      await slider.press('End');
    }
    const chart = sim.locator('.sdv-estimator svg[role="img"]').first();
    await expect(chart).toHaveAttribute('aria-label', /to (10M|100M|1B|10B) requests per second/);
  });
});

test.describe('bar rows', () => {
  for (const width of [390, 1440]) {
    test(`CQRS bar values end at the track's right edge at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('distributed-data/cqrs/');
      const rows = page.locator('.sdv-cqrs .sdv-bars li');
      await expect(rows.first()).toBeVisible();
      const gaps = await rows.evaluateAll((items) =>
        items.map((item) => {
          const value = item.querySelector('.sdv-bars__value')?.getBoundingClientRect();
          const track = item.querySelector('.sdv-bars__track')?.getBoundingClientRect();
          return value && track ? Math.abs(value.right - track.right) : 0;
        }),
      );
      expect(Math.max(...gaps)).toBeLessThanOrEqual(1);
    });
  }
});

test.describe('side by side lanes', () => {
  for (const path of ['reliability/rate-limiting/', 'scaling/load-balancing/']) {
    test(`${path} has no horizontal overflow at 390px`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(path);
      await page.locator('.sdv-duel__lanes').first().scrollIntoViewIfNeeded();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
      const overflowing = await page
        .locator('.sdv-duel__lane')
        .evaluateAll((lanes) => lanes.filter((lane) => lane.scrollWidth > lane.clientWidth + 1).length);
      expect(overflowing).toBe(0);
    });
  }
});

async function svgTextOutsideScroller(page: Page) {
  return page.locator('.sdv-scroll-x').evaluateAll((scrollers) =>
    scrollers.flatMap((scroller) => {
      const box = scroller.getBoundingClientRect();
      return Array.from(scroller.querySelectorAll('svg text'))
        .filter((text) => {
          const rect = text.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return false;
          return rect.left < box.left - 1 || rect.right > box.right + 1;
        })
        .map((text) => text.textContent?.trim() ?? '');
    }),
  );
}

test.describe('diagram scroll boxes on phones', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  for (const path of [
    'scaling/caching/',
    'distributed-data/cap-and-pacelc/',
    'distributed-data/quorums/',
    'distributed-data/sagas/',
    'distributed-data/raft/',
    'distributed-data/cqrs/',
    'ai-systems/gateway/',
  ]) {
    test(`${path} keeps every diagram label inside its box at 390px`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(path);
      await expect(page.locator('.sdv-scroll-x svg').first()).toBeAttached();
      expect(await svgTextOutsideScroller(page)).toEqual([]);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }

  test('a wide table shows a swipe cue and edge fade until the reader scrolls', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('distributed-data/quorums/');
    const table = page.getByRole('group', { name: 'Quorum settings comparison table, scrolls sideways' });
    await table.scrollIntoViewIfNeeded();
    await expect(table).toHaveAttribute('data-overflow-end', '');
    await expect(table).toHaveAttribute('tabindex', '0');
    const cue = page.locator('.sdv-scroll', { has: table }).locator('.sdv-scroll-cue');
    await expect(cue).toHaveText(/Swipe to see more/);
    await expect(cue.getByText('Scroll to see more')).toBeHidden();

    await table.evaluate((element) => {
      element.scrollLeft = 120;
    });
    await expect(cue).toHaveCount(0);
    await expect(table).toHaveAttribute('data-overflow-start', '');
  });
});

test.describe('diagram scroll boxes on desktop', () => {
  test('a diagram that fits takes no tab stop and shows no cue', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('distributed-data/quorums/');
    const ring = page.getByRole('group', { name: 'Replica ring diagram, scrolls sideways' });
    await ring.scrollIntoViewIfNeeded();
    await expect(ring).not.toHaveAttribute('tabindex');
    await expect(ring).not.toHaveAttribute('data-overflow-end');
    await expect(page.locator('.sdv-scroll', { has: ring }).locator('.sdv-scroll-cue')).toHaveCount(0);
  });
});
