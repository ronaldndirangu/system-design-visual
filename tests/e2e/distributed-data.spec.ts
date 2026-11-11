import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';

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

interface Scenario {
  radio: RegExp;
  end: string | RegExp;
}

interface SimCase {
  slug: string;
  region: string;
  first: Scenario;
  second: Scenario;
  /** Every promise shares one finished run, so switching keeps the results and Skip stays disabled. */
  sharedRun?: boolean;
}

// End-of-run readouts come from seeded models, so the prose and these tests can quote exact numbers.
const sims: SimCase[] = [
  {
    slug: 'consistency-models',
    region: 'Simulation: One chat, five promises',
    first: {
      radio: /^Eventual/,
      end: 'Tick 40 of 40, Eventual: 7 of 38 reads showed an anomaly, and people spent 0 ticks waiting.',
    },
    second: { radio: /^Monotonic reads/, end: /Monotonic reads: 3 of 35 reads showed an anomaly/ },
    sharedRun: true,
  },
  {
    slug: 'cap-and-pacelc',
    region: 'Simulation: One cart, two datacenters, one cut link',
    first: {
      radio: /^Link cut for 3 s/,
      end: '6.0 s of 6.0 s. Refuse when cut off (PC/EC): 20 answered, 8 refused, 0 out of date, 0 came back, average wait 104 ms. Accept everywhere (PA/EL): 28 answered, 0 refused, 7 out of date, 1 came back, average wait 5 ms.',
    },
    second: {
      radio: /^No cut/,
      end: /Accept everywhere \(PA\/EL\): 28 answered, 0 refused, 1 out of date, 0 came back, average wait 5 ms\./,
    },
  },
  {
    slug: 'quorums',
    region: "Simulation: Sam's cart on a ring of five replicas",
    first: {
      radio: /^N3 R1 W1/,
      end: '7.0 s of 7.0 s. N3 R1 W1 with all replicas up: 6 stale reads, 0 failed, 0 waiting, out of 29 requests. Confirmed to Sam: v12.',
    },
    second: {
      radio: /^N3 R2 W2/,
      end: '7.0 s of 7.0 s. N3 R2 W2 with all replicas up: 0 stale reads, 0 failed, 0 waiting, out of 29 requests. Confirmed to Sam: v12.',
    },
  },
  {
    slug: 'raft',
    region: 'Simulation: Simplified Raft: five servers agree on a chat log',
    first: {
      radio: /^Leader crash/,
      end: 'At 2.80 s, term 2, Node 3 leads. 6 of 6 chat messages committed.',
    },
    second: { radio: /^Split vote/, end: 'At 2.80 s, term 3, Node 2 leads. 6 of 6 chat messages committed.' },
  },
  {
    slug: 'sagas',
    region: 'Simulation: One checkout, two ways to coordinate',
    first: {
      radio: /^Happy path/,
      end: '3.2 s of 3.2 s. Orchestration: 6 completed, 0 compensated, 36 messages, charged $490, refunded $0. Choreography: 6 completed, 0 compensated, 48 messages, charged $490, refunded $0.',
    },
    second: {
      radio: /^Courier fails/,
      end: /Orchestration: 5 completed, 1 compensated, 40 messages, charged \$490, refunded \$75\. Choreography: 5 completed, 1 compensated, 52 messages/,
    },
  },
  {
    slug: 'cqrs',
    region: 'Simulation: Commands in, events out, views behind',
    first: {
      radio: /^Normal lag/,
      end: '24.0 s of 24 s. 95 events appended. Cart page at 95, 0 behind. Top items at 95, 0 behind. 19 of 95 page loads stale.',
    },
    second: { radio: /^Flash sale/, end: /156 events appended\..*43 of 156 page loads stale\./ },
  },
];

async function openSim(page: Page, slug: string, region: string): Promise<Locator> {
  await page.goto(`distributed-data/${slug}/`);
  const sim = page.getByRole('region', { name: region });
  await sim.scrollIntoViewIfNeeded();
  await expect(sim.getByRole('button', { name: 'Skip to the end' })).toBeEnabled();
  return sim;
}

async function press(page: Page, button: Locator, times = 1) {
  await button.focus();
  for (let i = 0; i < times; i += 1) await page.keyboard.press('Enter');
}

for (const { slug, region, first, second, sharedRun } of sims) {
  test(`distributed-data/${slug}/ simulation runs by keyboard to pinned results`, async ({ page }) => {
    const errors = collectErrors(page);
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    const sim = await openSim(page, slug, region);
    const live = sim.locator('[aria-live]');
    const skip = sim.getByRole('button', { name: 'Skip to the end' });
    const play = sim.getByRole('button', { name: 'Play', exact: true });
    const pause = sim.getByRole('button', { name: 'Pause', exact: true });

    await expect(sim.getByRole('radio', { name: first.radio })).toBeChecked();
    await press(page, sim.getByRole('button', { name: 'Step', exact: true }), 3);
    await expect(live).not.toHaveText('');

    await press(page, play);
    await expect(pause).toBeVisible();
    await press(page, pause);
    await expect(play).toBeVisible();

    await press(page, skip);
    await expect(live).toHaveText(first.end);
    expect(await axeViolations(page)).toEqual([]);

    await sim.getByRole('radio', { name: first.radio }).focus();
    await page.keyboard.press('ArrowRight');
    const next = sim.getByRole('radio', { name: second.radio });
    await expect(next).toBeChecked();
    await expect(next).toBeFocused();
    if (sharedRun) await expect(skip).toBeDisabled();
    else await press(page, skip);
    await expect(live).toHaveText(second.end);
    expect(errors).toEqual([]);
  });
}

test('distributed-data/raft/ crashing the leader by hand starts a new election', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const sim = await openSim(page, 'raft', 'Simulation: Simplified Raft: five servers agree on a chat log');
  const live = sim.locator('[aria-live]');
  const crash = sim.getByRole('button', { name: 'Crash the leader' });
  const recover = sim.getByRole('button', { name: 'Recover servers' });

  await expect(crash).toBeDisabled();
  await expect(recover).toBeDisabled();
  await press(page, sim.getByRole('button', { name: 'Step', exact: true }), 40);
  await expect(live).toContainText('At 0.40 s, term 1, Node 2 leads.');
  await expect(crash).toBeEnabled();

  await crash.click();
  await press(page, sim.getByRole('button', { name: 'Step', exact: true }));
  await expect(live).toContainText('no server leads');
  await expect(recover).toBeEnabled();
  await expect(sim.getByText('Node 2 (the leader) crashed.')).toBeVisible();
});

test('distributed-data/ simulations fit a phone screen at the end of a run', async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
  for (const { slug, region, first } of sims) {
    const sim = await openSim(page, slug, region);
    await press(page, sim.getByRole('button', { name: 'Skip to the end' }));
    await expect(sim.locator('[aria-live]')).toHaveText(first.end);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, slug).toBeLessThanOrEqual(0);
    expect(await axeViolations(page), slug).toEqual([]);
  }
});
