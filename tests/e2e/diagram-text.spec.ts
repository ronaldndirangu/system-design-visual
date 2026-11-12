import { expect, test } from '@playwright/test';
import { hydrateAll } from './helpers';

const pages = [
  'scaling/load-balancing/',
  'async/logs-and-pubsub/',
  'foundations/storage-engines/',
  'scaling/caching/',
  'scaling/sharding/',
];

interface Finding {
  text: string;
  problem: string;
}

for (const width of [390, 320]) {
  test.describe(`diagram text at ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    for (const path of pages) {
      test(`${path} keeps node text legible and inside its shape`, async ({ page }) => {
        await page.goto(path);
        await hydrateAll(page);
        const svgs = page.locator('.sdv-steps svg[role="img"], .sdv-arc svg[role="img"]');
        expect(await svgs.count()).toBeGreaterThan(0);

        // Text counter-scales once the island measures its rendered width, so poll until it settles.
        const findings = () =>
          svgs.evaluateAll((elements) => {
            const found: Finding[] = [];
            const overlaps = (a: DOMRect, b: DOMRect) =>
              a.left < b.right - 0.5 &&
              b.left < a.right - 0.5 &&
              a.top < b.bottom - 0.5 &&
              b.top < a.bottom - 0.5;
            for (const svg of elements as SVGSVGElement[]) {
              const zoom = svg.getScreenCTM()?.a ?? 1;
              const texts = [
                ...svg.querySelectorAll<SVGTextElement>('.sdv-node__label, .sdv-node__sublabel'),
              ];
              const items = texts.map((text) => ({ text, box: text.getBoundingClientRect() }));
              items.forEach(({ text, box }, i) => {
                const label = text.textContent ?? '';
                const px = Number.parseFloat(getComputedStyle(text).fontSize) * zoom;
                if (px < 11.9) found.push({ text: label, problem: `renders at ${px.toFixed(1)}px` });
                if (text.classList.contains('sdv-node__label')) {
                  const shape = text.parentElement
                    ?.querySelector('.sdv-node__shape')
                    ?.getBoundingClientRect();
                  if (
                    shape &&
                    (box.left < shape.left - 1 ||
                      box.right > shape.right + 1 ||
                      box.top < shape.top - 1 ||
                      box.bottom > shape.bottom + 1)
                  ) {
                    found.push({ text: label, problem: 'spills out of its shape' });
                  }
                }
                for (const other of items.slice(i + 1)) {
                  if (overlaps(box, other.box)) {
                    found.push({ text: label, problem: `overlaps "${other.text.textContent}"` });
                  }
                }
              });
            }
            return found;
          });

        await expect.poll(findings, { timeout: 5_000 }).toEqual([]);
      });
    }
  });
}
