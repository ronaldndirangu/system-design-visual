import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
  });
  return errors;
}

async function axeViolations(page: Page): Promise<string[]> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .exclude('button[data-open-modal]')
    .analyze();
  return results.violations.flatMap((violation) =>
    violation.nodes.map((node) => `${violation.id}: ${node.target.join(' ')} ${node.failureSummary}`),
  );
}

test.describe('Timeouts and cancellation', () => {
  test('the timeout duel runs by keyboard and resets on a new scenario', async ({ page }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.goto('reliability/timeouts/');
    const duel = page.getByRole('region', { name: 'Simulation: Same traffic, two timeout settings' });
    await duel.scrollIntoViewIfNeeded();
    const skip = duel.getByRole('button', { name: 'Skip to the end' });
    const served = duel.getByRole('row', { name: /Redirects served/ });

    await expect(skip).toBeEnabled();
    await skip.focus();
    await page.keyboard.press('Enter');
    await expect(served).toContainText('615');
    await expect(served).toContainText('853');
    await expect(served).toContainText('Better');
    await expect(duel.getByText('Run complete')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);

    const healthy = duel.getByRole('radio', { name: /All replicas healthy/ });
    await duel.getByRole('radio', { name: /Replica C hangs/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(healthy).toBeChecked();
    await expect(healthy).toBeFocused();
    await expect(duel.getByText('Ready', { exact: true })).toBeVisible();
    await skip.focus();
    await page.keyboard.press('Enter');
    await expect(served).toContainText('1007');
    await expect(served).not.toContainText('Better');
    expect(errors).toEqual([]);
  });

  test('cancelling the query frees database connections', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('reliability/timeouts/');
    const duel = page.getByRole('region', { name: 'Simulation: Timing out without cancelling' });
    await duel.scrollIntoViewIfNeeded();
    const skip = duel.getByRole('button', { name: 'Skip to the end' });
    await expect(skip).toBeEnabled();
    await skip.click();
    const nobody = duel.getByRole('row', { name: /Queries finished for nobody/ });
    await expect(nobody).toContainText('449');
    await expect(duel.getByRole('row', { name: /Timed out \(504\)/ })).toContainText('154');
  });

  test('passing the deadline along stops every hop when the client gives up', async ({ page }) => {
    await page.goto('reliability/timeouts/');
    const widget = page.getByRole('region', { name: 'Interactive: One deadline, four hops' });
    await widget.scrollIntoViewIfNeeded();
    const late = widget.getByRole('row', { name: /Work after the client gave up/ });
    await expect(late).toContainText('1540 ms');

    const propagate = widget.getByRole('radio', { name: 'Pass the deadline along' });
    await expect(propagate).toBeEnabled();
    await propagate.check();
    await expect(late).toContainText('None');
    await expect(widget.getByText('Gave up, and everything stopped')).toBeVisible();
  });
});

test.describe('Queues and backpressure', () => {
  test('a bounded line beats an unbounded one in a viral spike and is axe clean in both themes', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.goto('reliability/queues-and-backpressure/');
    const duel = page.getByRole('region', { name: 'Simulation: Same traffic, two waiting lines' });
    await duel.scrollIntoViewIfNeeded();
    await expect(duel.getByTestId('queue-canvas')).toHaveCount(0);
    const skip = duel.getByRole('button', { name: 'Skip to the end' });
    const served = duel.getByRole('row', { name: /Answered in time/ });

    await expect(skip).toBeEnabled();
    await skip.focus();
    await page.keyboard.press('Enter');
    await expect(served).toContainText('265');
    await expect(served).toContainText('946');
    await expect(duel.getByRole('row', { name: /Still inside the server/ })).toContainText('266');
    await expect(duel.getByText('Run complete')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await axeViolations(page)).toEqual([]);

    const steady = duel.getByRole('radio', { name: /Steady traffic/ });
    await duel.getByRole('radio', { name: /Viral link/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(steady).toBeChecked();
    await expect(duel.getByText('Ready', { exact: true })).toBeVisible();
    await skip.click();
    await expect(served).toContainText('800');
    await expect(served).not.toContainText('Better');

    const physics = duel.getByRole('switch', { name: 'Physics animation' });
    await physics.focus();
    await page.keyboard.press('Space');
    await expect(physics).toBeChecked();
    await expect(duel.getByTestId('queue-canvas')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a queue absorbs the bursts that a server with no line turns away', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('reliability/queues-and-backpressure/');
    const duel = page.getByRole('region', { name: 'Simulation: A short burst, with and without a line' });
    await duel.scrollIntoViewIfNeeded();
    const skip = duel.getByRole('button', { name: 'Skip to the end' });
    await expect(skip).toBeEnabled();
    await skip.click();
    await expect(duel.getByRole('row', { name: /Turned away at the door/ })).toContainText('187');
    await expect(duel.getByRole('row', { name: /Answered in time/ })).toContainText('845');
  });

  test('shedding by expected wait answers more visitors when redirects slow down', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('reliability/queues-and-backpressure/');
    const duel = page.getByRole('region', {
      name: 'Simulation: Slow redirects: line limit against wait budget',
    });
    await duel.scrollIntoViewIfNeeded();
    const skip = duel.getByRole('button', { name: 'Skip to the end' });
    await expect(skip).toBeEnabled();
    await skip.click();
    const late = duel.getByRole('row', { name: /Answered late/ });
    await expect(late).toContainText('230');
    await expect(duel.getByRole('row', { name: /Answered in time/ })).toContainText('657');
  });
});
