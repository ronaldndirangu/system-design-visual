import { expect, type Page, test } from '@playwright/test';
import { documentOverflow } from './helpers';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const pages = [
  { name: 'home', path: './' },
  { name: 'curriculum', path: 'curriculum/' },
  { name: 'lesson', path: 'scaling/caching/' },
  { name: 'case study', path: 'case-studies/shortener-at-scale/' },
  { name: 'glossary', path: 'glossary/' },
  { name: '404', path: 'does-not-exist/' },
];

/** Selectors exempt from the sweep, each with the reason a small target is acceptable there. */
const allowlist: { selector: string; reason: string }[] = [
  {
    selector: '.sl-skip-link',
    reason: 'Keyboard-only skip link, positioned off screen until it receives focus.',
  },
];

interface Miss {
  label: string;
  width: number;
  height: number;
}

/** Lists visible targets below 44 by 44 CSS px that also fail the WCAG 2.5.8 inline spacing exception. */
function undersized(page: Page, scope: string): Promise<Miss[]> {
  return page.evaluate(
    ({ scope, skip }) => {
      const full = 44;
      const minimum = 24;
      const root = document.querySelector(scope) ?? document.body;
      const candidates = [
        ...root.querySelectorAll<HTMLElement>(
          'a[href], button, summary, [role="button"], input:not([type="hidden"])',
        ),
      ].filter(
        (el) =>
          !skip.some((selector) => el.closest(selector)) &&
          el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) &&
          el.getClientRects().length > 0,
      );

      // A stretched-link overlay drawn with an absolutely positioned pseudo-element widens the hit area.
      const hitArea = (el: HTMLElement): DOMRect => {
        let rect = el.getBoundingClientRect();
        if (el instanceof HTMLInputElement) {
          for (const label of el.labels ?? []) {
            const box = label.getBoundingClientRect();
            if (box.width * box.height > rect.width * rect.height) rect = box;
          }
        }
        for (const pseudo of ['::before', '::after']) {
          const style = getComputedStyle(el, pseudo);
          if (style.content === 'none' || style.position !== 'absolute') continue;
          const block = getComputedStyle(el).position === 'static' ? el.offsetParent : el;
          if (!block) continue;
          const box = block.getBoundingClientRect();
          const inset = (value: string) => (value === 'auto' ? Number.NaN : Number.parseFloat(value));
          const top = inset(style.top);
          const right = inset(style.right);
          const bottom = inset(style.bottom);
          const left = inset(style.left);
          if ([top, right, bottom, left].some(Number.isNaN)) continue;
          const overlay = new DOMRect(
            box.left + left,
            box.top + top,
            box.width - left - right,
            box.height - top - bottom,
          );
          if (overlay.width * overlay.height > rect.width * rect.height) rect = overlay;
        }
        return rect;
      };

      const inlineText = (el: HTMLElement) =>
        el.tagName === 'A' &&
        getComputedStyle(el).display === 'inline' &&
        el.closest('p, li, td, dd') !== null;
      // A link that wraps onto two lines owns one box per line; its bounding box would cover unrelated neighbors.
      const targets = candidates.map((el) => {
        const rect = hitArea(el);
        return { el, rect, boxes: inlineText(el) ? [...el.getClientRects()] : [rect] };
      });
      const distance = (x: number, y: number, rect: DOMRect) =>
        Math.hypot(Math.max(rect.left - x, 0, x - rect.right), Math.max(rect.top - y, 0, y - rect.bottom));

      const misses: Miss[] = [];
      for (const { el, rect } of targets) {
        if (rect.width >= full - 0.5 && rect.height >= full - 0.5) continue;
        if (inlineText(el)) {
          if (rect.width >= minimum && rect.height >= minimum) continue;
          const cx = rect.left + rect.width / 2;
          const cy = rect.top + rect.height / 2;
          const spaced = targets.every(
            (other) =>
              other.el === el ||
              other.el.contains(el) ||
              el.contains(other.el) ||
              other.boxes.every((box) => distance(cx, cy, box) >= minimum / 2),
          );
          if (spaced) continue;
        }
        const name = (el.getAttribute('aria-label') ?? el.textContent ?? '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 40);
        const classes =
          el.className && typeof el.className === 'string'
            ? `.${el.className.trim().split(/\s+/).join('.')}`
            : '';
        misses.push({
          label: `${el.tagName.toLowerCase()}${classes} "${name}"`,
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
      return misses;
    },
    { scope, skip: allowlist.map((entry) => entry.selector) },
  );
}

for (const { name, path } of pages) {
  test(`${name}: touch targets reach 44px or keep 24px spacing`, async ({ page }) => {
    await page.goto(path);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    // Starlight's mobile table of contents is a dropdown that overlays the page when open, so leave it shut.
    await page.evaluate(() => {
      for (const details of document.querySelectorAll<HTMLDetailsElement>('main details'))
        details.open = true;
    });
    expect.soft(await undersized(page, 'body')).toEqual([]);

    const menu = page.getByRole('button', { name: 'Menu' });
    if ((await menu.count()) > 0) {
      await menu.click();
      await expect(page.locator('#starlight__sidebar')).toBeVisible();
      expect.soft(await undersized(page, '#starlight__sidebar')).toEqual([]);
    }
  });
}

test.describe('320px wide', () => {
  test.use({ viewport: { width: 320, height: 844 } });

  test('glossary: no horizontal document overflow', async ({ page }) => {
    await page.goto('glossary/');
    expect(await documentOverflow(page)).toBeLessThanOrEqual(0);
  });
});
