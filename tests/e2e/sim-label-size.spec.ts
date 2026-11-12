import { expect, type Page, test } from '@playwright/test';
import { documentOverflow, hydrateAll } from './helpers';

const pages = [
  'scaling/caching/',
  'foundations/what-happens-when-you-click/',
  'distributed-data/raft/',
  'ai-systems/evaluation-and-budgets/',
];

const MIN_PX = 12;

interface Finding {
  text: string;
  problem: string;
}

/** Every visible SVG label in the lesson, measured at its rendered size after the drawing's own scaling. */
function findings(page: Page): Promise<Finding[]> {
  return page.evaluate((minPx) => {
    const found: Finding[] = [];
    for (const text of document.querySelectorAll<SVGTextElement>('main svg text')) {
      const label = (text.textContent ?? '').trim();
      if (!label || text.getClientRects().length === 0) continue;
      const style = getComputedStyle(text);
      if (style.visibility === 'hidden' || Number.parseFloat(style.opacity) === 0) continue;
      const ctm = text.getScreenCTM();
      if (!ctm) continue;
      const px = Number.parseFloat(style.fontSize) * Math.hypot(ctm.a, ctm.b);
      if (px < minPx - 0.1) found.push({ text: label, problem: `renders at ${px.toFixed(2)}px` });
      if (text.classList.contains('sdv-node__label')) {
        const shape = text.parentElement?.querySelector('.sdv-node__shape')?.getBoundingClientRect();
        const box = text.getBoundingClientRect();
        if (
          shape &&
          (box.left < shape.left - 1 ||
            box.right > shape.right + 1 ||
            box.top < shape.top - 1 ||
            box.bottom > shape.bottom + 1)
        ) {
          found.push({ text: label, problem: 'spills out of its node' });
        }
      }
    }
    return found;
  }, MIN_PX);
}

async function expectReadable(page: Page) {
  // Text grows once each island measures its rendered width, so poll until it settles.
  await expect.poll(() => findings(page), { timeout: 5_000 }).toEqual([]);
  expect(await documentOverflow(page)).toBe(0);
}

for (const width of [390, 320]) {
  for (const theme of ['dark', 'light'] as const) {
    test.describe(`simulation labels at ${width}px, ${theme} theme`, () => {
      test.use({ viewport: { width, height: 900 }, isMobile: true, hasTouch: true });

      for (const path of pages) {
        test(`${path} keeps every SVG label at ${MIN_PX}px or more, before and after a step`, async ({
          page,
        }) => {
          await page.addInitScript((value) => localStorage.setItem('starlight-theme', value), theme);
          await page.goto(path);
          await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
          await hydrateAll(page);
          await expectReadable(page);

          const steps = page.locator('.sdv-sim').getByRole('button', { name: 'Step', exact: true });
          expect(await steps.count()).toBeGreaterThan(0);
          for (const button of await steps.all()) {
            await button.scrollIntoViewIfNeeded();
            await button.click();
          }
          await expectReadable(page);
        });
      }
    });
  }
}
