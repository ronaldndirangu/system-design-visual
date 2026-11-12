import { expect, type Locator } from '@playwright/test';

/** Waits until the island holding `locator` has hydrated and responds to input. */
export async function island(locator: Locator): Promise<Locator> {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator.locator('xpath=ancestor-or-self::astro-island[1]')).toHaveAttribute(
    'data-hydrated',
    '',
  );
  return locator;
}
