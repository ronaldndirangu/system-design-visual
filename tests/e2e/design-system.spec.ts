import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';
import { island } from './helpers';

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
    await expect(sim.getByRole('radiogroup', { name: 'Scale' })).toBeHidden();
    await select.selectOption({ label: 'Planet scale' });
    await expect(select).toHaveValue('planet');

    await page.setViewportSize({ width: 1440, height: 900 });
    sim = await openEstimator(page);
    await expect(sim.getByRole('radiogroup', { name: 'Scale' })).toBeVisible();
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
      // Diagrams below their width floor scroll sideways, so text must sit inside the scrollable extent.
      const left = scroller.getBoundingClientRect().left - scroller.scrollLeft;
      const right = left + scroller.scrollWidth;
      return Array.from(scroller.querySelectorAll('svg text'))
        .filter((text) => {
          const rect = text.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return false;
          return rect.left < left - 1 || rect.right > right + 1;
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

async function useTheme(page: Page, theme: 'dark' | 'light') {
  await page.addInitScript((value) => localStorage.setItem('starlight-theme', value), theme);
}

async function cumulativeLayoutShift(page: Page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return new Promise<number>((resolve) => {
      let total = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & {
          value: number;
          hadRecentInput: boolean;
        })[]) {
          if (!entry.hadRecentInput) total += entry.value;
        }
        resolve(total);
      }).observe({ type: 'layout-shift', buffered: true });
      setTimeout(() => resolve(total), 250);
    });
  });
}

test.describe('type and tokens', () => {
  test('body text uses Inter and code uses JetBrains Mono within the font budget', async ({ page }) => {
    const fontBytes: Promise<number>[] = [];
    page.on('response', (response) => {
      if (response.request().resourceType() === 'font') fontBytes.push(response.body().then((b) => b.length));
    });
    await page.goto('distributed-data/quorums/');
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      const code = document.querySelector('.sl-markdown-content code');
      return {
        body: getComputedStyle(document.body).fontFamily,
        code: code ? getComputedStyle(code).fontFamily : '',
        loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
      };
    });
    expect(fonts.body).toContain('Inter Variable');
    expect(fonts.code).toContain('JetBrains Mono Variable');
    expect(fonts.loaded.map((f) => f.replaceAll('"', ''))).toContain('Inter Variable');
    const total = (await Promise.all(fontBytes)).reduce((sum, n) => sum + n, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(120 * 1024);
  });

  test('the head preloads Inter and sets a theme color per scheme', async ({ page }) => {
    await page.goto('');
    await expect(page.locator('link[rel="preload"][as="font"][href*="inter-latin-wght-normal"]')).toHaveCount(
      1,
    );
    await expect(page.locator('meta[name="theme-color"]')).toHaveCount(2);
  });

  for (const [theme, background] of [
    ['dark', 'rgb(94, 92, 230)'],
    ['light', 'rgb(79, 70, 229)'],
  ] as const) {
    test(`the primary call to action is white on the accent in the ${theme} theme`, async ({ page }) => {
      await useTheme(page, theme);
      await page.goto('');
      const cta = page.locator('.sl-link-button.primary').first();
      await expect(cta).toHaveCSS('color', 'rgb(255, 255, 255)');
      await expect(cta).toHaveCSS('background-color', background);
    });
  }

  for (const path of ['', 'distributed-data/quorums/']) {
    test(`/${path} shifts layout by less than 0.05 while fonts load`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path);
      expect(await cumulativeLayoutShift(page)).toBeLessThan(0.05);
    });
  }
});

async function minTargetPx(page: Page, selector: string) {
  return page.locator(selector).evaluateAll((elements) =>
    Math.min(
      ...elements.map((element) => {
        const box = element.getBoundingClientRect();
        return Math.min(box.width, box.height);
      }),
    ),
  );
}

test.describe('control kit', () => {
  test('arrow keys move the segmented choice and keep focus on it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const sim = await openEstimator(page);
    const group = sim.getByRole('radiogroup', { name: 'Scale' });
    const checked = group.getByRole('radio', { checked: true });
    const before = await checked.getAttribute('value');
    await checked.focus();
    await page.keyboard.press('ArrowRight');
    await expect(checked).not.toHaveAttribute('value', before ?? '');
    await expect(checked).toBeFocused();
    await expect(sim.getByRole('combobox', { name: 'Scale', includeHidden: true })).toHaveValue(
      (await checked.getAttribute('value')) ?? '',
    );
  });

  test('Home, End and arrow keys update the slider value text', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const sim = await openEstimator(page);
    const slider = sim.getByRole('slider', { name: 'New links per day' });
    await slider.focus();
    await slider.press('Home');
    const min = await slider.getAttribute('aria-valuetext');
    await expect(slider).toHaveValue((await slider.getAttribute('min')) ?? '');
    await slider.press('ArrowRight');
    await expect(slider).not.toHaveAttribute('aria-valuetext', min ?? '');
    await slider.press('End');
    await expect(slider).toHaveValue((await slider.getAttribute('max')) ?? '');
    const max = await slider.getAttribute('aria-valuetext');
    await expect(
      sim
        .locator('output')
        .filter({ hasText: max ?? '' })
        .first(),
    ).toBeVisible();
  });

  test('speed is a radio group in a wide toolbar and a select in a narrow one', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('reliability/rate-limiting/');
    const toolbar = page.getByRole('group', { name: 'Simulation controls' }).first();
    await toolbar.scrollIntoViewIfNeeded();
    const radios = toolbar.getByRole('radiogroup', { name: 'Speed' });
    await expect(radios).toBeVisible();
    await expect(toolbar.getByRole('combobox', { name: 'Speed' })).toBeHidden();
    await island(radios);
    await radios.getByRole('radio', { name: '2×' }).check();
    await expect(radios.getByRole('radio', { name: '2×' })).toBeChecked();

    await page.setViewportSize({ width: 390, height: 844 });
    const select = toolbar.getByRole('combobox', { name: 'Speed' });
    await expect(select).toBeVisible();
    await expect(radios).toBeHidden();
    await expect(select).toHaveValue('2');
  });

  for (const theme of ['dark', 'light'] as const) {
    test(`a simulation with the kit passes axe in the ${theme} theme`, async ({ page }) => {
      await useTheme(page, theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto('reliability/rate-limiting/');
      const toolbar = page.getByRole('group', { name: 'Simulation controls' }).first();
      await toolbar.scrollIntoViewIfNeeded();
      await island(toolbar);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .exclude('button[data-open-modal]')
        .analyze();
      expect(results.violations.map((violation) => violation.id)).toEqual([]);
    });
  }
});

test.describe('control kit on coarse pointers', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  for (const [path, selector] of [
    ['foundations/what-happens-when-you-click/', '.sdv-segmented__options label:visible'],
    ['reliability/observability/', '.sdv-segmented select:visible'],
    ['foundations/what-happens-when-you-click/', '.sdv-toggle:visible'],
    ['thinking/requirements-and-estimates/', '.sdv-select:visible'],
  ] as const) {
    test(`${selector.split(':')[0]} targets on ${path} are at least 44px`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(path);
      await expect(page.locator(selector).first()).toBeVisible();
      expect(await minTargetPx(page, selector)).toBeGreaterThanOrEqual(44);
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  }
});
