import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

const lessons = [
  { path: 'ai-systems/recommendations/', region: 'Where the time goes', scrolls: true },
  { path: 'foundations/apis/', region: 'Status codes say what happened', scrolls: false },
];

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('button[data-open-modal]')
    .analyze();
  return results.violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id}: ${node.target.join(' ')} ${node.failureSummary}`),
  );
}

test.describe('lesson tables on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const { path, region, scrolls } of lessons) {
    for (const colorScheme of ['light', 'dark'] as const) {
      test(`${path} wraps every table in a named, focusable scroll region in ${colorScheme} mode`, async ({
        page,
      }) => {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await page.goto(path);

        const wrappers = await page.locator('.sl-markdown-content table:not([class])').evaluateAll((tables) =>
          tables.map((table) => {
            const wrapper = table.parentElement;
            return {
              wrapped: wrapper?.classList.contains('sdv-table-scroll') ?? false,
              tabindex: wrapper?.getAttribute('tabindex'),
              role: wrapper?.getAttribute('role'),
              named: Boolean(wrapper?.getAttribute('aria-label')?.trim()),
              tableDisplay: getComputedStyle(table).display,
              tableOverflow: getComputedStyle(table).overflowX,
            };
          }),
        );
        expect(wrappers.length).toBeGreaterThan(0);
        for (const wrapper of wrappers) {
          expect(wrapper).toEqual({
            wrapped: true,
            tabindex: '0',
            role: 'region',
            named: true,
            tableDisplay: 'table',
            tableOverflow: 'visible',
          });
        }

        const scroller = page.getByRole('region', { name: region, exact: true });
        await scroller.scrollIntoViewIfNeeded();
        if (scrolls)
          expect(await scroller.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true);
        await scroller.focus();
        await expect(scroller).toBeFocused();
        expect(await scroller.evaluate((node) => getComputedStyle(node).outlineStyle)).toBe('solid');

        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        expect(await axeViolations(page)).toEqual([]);
      });
    }
  }
});
