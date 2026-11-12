import { expect, type Locator, type Page } from '@playwright/test';

/** Bring every visible client:visible island into view and wait until Astro marks it hydrated. */
export async function hydrateAll(page: Page) {
  // A closed disclosure hides its content: islands inside never intersect, and the checks would skip what it reveals.
  await page.evaluate(() => {
    for (const details of document.querySelectorAll<HTMLDetailsElement>('.sl-markdown-content details')) {
      details.open = true;
    }
  });
  await expect
    .poll(
      () =>
        page.evaluate(async () => {
          const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
          // Astro removes the ssr attribute once an island hydrates. Islands with nothing rendered never enter view.
          const pending = () =>
            [...document.querySelectorAll('astro-island[ssr]')].filter((island) =>
              [...island.children].some((child) => child.getClientRects().length > 0),
            );
          for (const island of pending()) {
            island.firstElementChild?.scrollIntoView({ block: 'center' });
            await nextFrame();
            await nextFrame();
          }
          return pending().length;
        }),
      { message: 'islands still waiting to hydrate', timeout: 15_000 },
    )
    .toBe(0);
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** How far the page scrolls sideways; anything above zero means content spills past the viewport. */
export function documentOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** Waits until the island holding `locator` has hydrated and responds to input. */
export async function island(locator: Locator): Promise<Locator> {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator.locator('xpath=ancestor-or-self::astro-island[1]')).toHaveAttribute(
    'data-hydrated',
    '',
  );
  return locator;
}
