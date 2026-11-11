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

test.describe('Idempotency', () => {
  test('a claimed key stops double charges on a lossy network and is axe clean in both themes', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.goto('reliability/idempotency/');
    const duel = page.getByRole('region', { name: 'Simulation: Same purchases, with and without a key' });
    await duel.scrollIntoViewIfNeeded();
    const skip = duel.getByRole('button', { name: 'Skip to the end' });
    const twice = duel.getByRole('row', { name: /Orders charged twice/ });

    await expect(skip).toBeEnabled();
    await skip.focus();
    await page.keyboard.press('Enter');
    await expect(duel.getByRole('row', { name: /Card charges/ })).toContainText('73');
    await expect(twice).toContainText('9');
    await expect(twice).toContainText('Better');
    await expect(duel.getByRole('row', { name: /Money taken by mistake/ })).toContainText('$45');
    await expect(duel.getByText('Run complete')).toBeVisible();
    await expect(duel.getByText(/No key: Order #21 is charged twice/)).toBeVisible();
    await expect(
      duel.getByRole('region', { name: 'No key' }).getByText('9 orders charged twice'),
    ).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await axeViolations(page)).toEqual([]);

    const calm = duel.getByRole('radio', { name: /Healthy network/ });
    await duel.getByRole('radio', { name: /Lossy mobile network/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(calm).toBeChecked();
    await expect(calm).toBeFocused();
    await expect(duel.getByText('Ready', { exact: true })).toBeVisible();
    await skip.click();
    await expect(duel.getByRole('row', { name: /Card charges/ })).toContainText('64');
    await expect(twice).not.toContainText('Better');
    expect(errors).toEqual([]);
  });

  test('a key claimed first answers 409 to retries that arrive mid payment', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('reliability/idempotency/');
    const duel = page.getByRole('region', { name: 'Simulation: A retry that arrives too early' });
    await duel.scrollIntoViewIfNeeded();
    const skip = duel.getByRole('button', { name: 'Skip to the end' });
    await expect(skip).toBeEnabled();
    await skip.click();
    await expect(duel.getByRole('row', { name: /Orders charged twice/ })).toContainText('10');
    await expect(duel.getByRole('row', { name: /Retries answered 409/ })).toContainText('16');
    await expect(duel.getByRole('row', { name: /Attempts sent/ })).toContainText('91');
  });
});

test.describe('Retries', () => {
  test('retries keep the slowdown going, and the herd shows why jitter matters', async ({ page }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.goto('reliability/retries/');
    const duel = page.getByRole('region', { name: 'Simulation: Same clicks, retries or none' });
    await duel.scrollIntoViewIfNeeded();
    const skip = duel.getByRole('button', { name: 'Skip to the end' });

    await expect(skip).toBeEnabled();
    await skip.focus();
    await page.keyboard.press('Enter');
    const confirmed = duel.getByRole('row', { name: /Clicks confirmed/ });
    await expect(confirmed).toContainText('2475');
    await expect(confirmed).toContainText('567');
    await expect(duel.getByRole('row', { name: /Attempts sent/ })).toContainText('10006');
    await expect(duel.getByText('Run complete')).toBeVisible();
    expect(await axeViolations(page)).toEqual([]);
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await axeViolations(page)).toEqual([]);

    const calm = duel.getByRole('radio', { name: /Normal day/ });
    await duel.getByRole('radio', { name: /Slowdown at 3 s/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(calm).toBeChecked();
    await expect(calm).toBeFocused();
    await expect(duel.getByText('Ready', { exact: true })).toBeVisible();

    const herd = page.getByRole('region', { name: 'Simulation: Forty senders reconnect after a restart' });
    await herd.scrollIntoViewIfNeeded();
    const herdSkip = herd.getByRole('button', { name: 'Skip to the end' });
    await expect(herdSkip).toBeEnabled();
    await herdSkip.click();
    await expect(herd.getByRole('row', { name: /Still waiting/ })).toContainText('28');
    const attempts = herd.getByRole('row', { name: /Attempts sent/ });
    await expect(attempts).toContainText('222');
    await expect(attempts).toContainText('163');
    expect(errors).toEqual([]);
  });
});

test.describe('Circuit breakers', () => {
  test('a breaker keeps redirects answering through a hang and probes gently', async ({ page }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.goto('reliability/circuit-breakers/');
    const duel = page.getByRole('region', { name: 'Simulation: Same redirects, with and without a breaker' });
    await duel.scrollIntoViewIfNeeded();
    const skip = duel.getByRole('button', { name: 'Skip to the end' });

    await expect(skip).toBeEnabled();
    await skip.focus();
    await page.keyboard.press('Enter');
    const answered = duel.getByRole('row', { name: /Redirects answered/ });
    await expect(answered).toContainText('1998');
    await expect(answered).toContainText('2944');
    const rejected = duel.getByRole('row', { name: /Turned away with 503/ });
    await expect(rejected).toContainText('1016');
    await expect(rejected).toContainText('70');
    await expect(duel.getByRole('row', { name: /Times the breaker opened/ })).toContainText('4');
    await expect(duel.getByText('Run complete')).toBeVisible();
    await expect(duel).toContainText('the breaker opens after 18 of the last 20 calls failed');
    expect(await axeViolations(page)).toEqual([]);
    await page.emulateMedia({ colorScheme: 'light' });
    expect(await axeViolations(page)).toEqual([]);

    const calm = duel.getByRole('radio', { name: /Normal day/ });
    await duel.getByRole('radio', { name: /Ingest hangs at 3 s/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(calm).toBeChecked();
    await expect(calm).toBeFocused();
    await expect(duel.getByText('Ready', { exact: true })).toBeVisible();

    const refused = page.getByRole('region', { name: 'Simulation: Ingest refuses connections' });
    await refused.scrollIntoViewIfNeeded();
    await refused.getByRole('button', { name: 'Skip to the end' }).click();
    const calls = refused.getByRole('row', { name: /Calls sent to ingest/ });
    await expect(calls).toContainText('3018');
    await expect(calls).toContainText('1514');

    const probe = page.getByRole('region', { name: 'Simulation: Three probes or everyone' });
    await probe.scrollIntoViewIfNeeded();
    await probe.getByRole('button', { name: 'Skip to the end' }).click();
    const probes = probe.getByRole('row', { name: /Probe calls while half-open/ });
    await expect(probes).toContainText('61');
    await expect(probes).toContainText('12');
    expect(errors).toEqual([]);
  });
});
