import { expect, type Locator, type Page, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
});

/** Scroll a simulation into view and wait for its island to hydrate. */
async function simulation(page: Page, title: string, kind = 'Simulation'): Promise<Locator> {
  const sim = page.getByRole('region', { name: `${kind}: ${title}` });
  await sim.scrollIntoViewIfNeeded();
  if (kind === 'Simulation') await expect(sim.getByRole('button', { name: 'Skip to the end' })).toBeEnabled();
  return sim;
}

async function skipToEnd(sim: Locator) {
  await sim.getByRole('button', { name: 'Skip to the end' }).click();
  await expect(sim.locator('.sdv-sim__header')).toContainText('Run complete');
}

async function choose(sim: Locator, chip: RegExp): Promise<Locator> {
  const radio = sim.getByRole('radio', { name: chip });
  await sim
    .locator('label.sdv-chips__chip')
    .filter({ has: sim.page().getByRole('radio', { name: chip }) })
    .click();
  await expect(radio).toBeChecked();
  return radio;
}

async function pick(sim: Locator, chip: RegExp) {
  await choose(sim, chip);
  await expect(sim.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
}

/** The value cells of one readout row, without the badges and notes beside them. */
function values(sim: Locator, label: string): Locator {
  return sim
    .getByRole('row')
    .filter({ has: sim.page().getByRole('rowheader', { name: label, exact: true }) })
    .locator('.sdv-stats__value');
}

test('logs and pub/sub: lag grows with one consumer, a crash rereads, and keys keep order', async ({
  page,
}) => {
  await page.goto('async/logs-and-pubsub/');
  const group = await simulation(page, 'A consumer group reads the click log');
  await skipToEnd(group);
  await expect(values(group, 'Lag now (events not read yet)')).toHaveText(['637']);
  await expect(group.getByRole('row', { name: /Lag now/ })).toContainText('Falling behind');

  await group.getByRole('radio', { name: /^One consumer/ }).focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: /^A consumer crashes/ })).toBeChecked();
  await group.getByRole('button', { name: 'Skip to the end' }).focus();
  await page.keyboard.press('Enter');
  await expect(values(group, 'Peak lag')).toHaveText(['222']);
  await expect(values(group, 'Processed again after a rewind')).toHaveText(['58']);

  const ordering = await simulation(page, 'Same clicks, two ways to pick a partition');
  await skipToEnd(ordering);
  await expect(values(ordering, 'Clicks written (same clicks)')).toHaveText(['840', '840']);
  await expect(values(ordering, 'Counted out of order')).toHaveText(['0', '104']);
});

test('logs and pub/sub: Step while paused and group changes at any time update the live region', async ({
  page,
}) => {
  await page.goto('async/logs-and-pubsub/');
  const group = await simulation(page, 'A consumer group reads the click log');
  const live = group.locator('[aria-live]');
  await expect(live).toHaveCount(1);

  await group.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(live).toHaveText(/^0\.1 s of 20 s\. Lag /);
  await group.getByRole('button', { name: 'Step', exact: true }).click();
  await expect(live).toHaveText(/^0\.2 s of 20 s\. Lag /);

  await group.getByRole('button', { name: 'Crash consumer 1' }).click();
  await expect(live).toContainText('Consumer 1 crashes');

  await group.getByRole('button', { name: 'Play', exact: true }).click();
  await group.getByRole('button', { name: 'Add a consumer' }).click();
  await expect(live).toContainText(/Consumer \d+ joins the group/);
});

test('delivery semantics: the dual write loses or invents events and the outbox does neither', async ({
  page,
}) => {
  await page.goto('async/delivery-semantics/');
  const outbox = await simulation(page, 'Dual write versus transactional outbox');
  await skipToEnd(outbox);
  await expect(values(outbox, 'Lost events (row saved, no event)')).toHaveText(['62', '0']);
  await expect(values(outbox, 'Events sent twice')).toHaveText(['0', '5']);

  await pick(outbox, /^Publish, then commit/);
  await skipToEnd(outbox);
  await expect(values(outbox, 'Phantom events (event, no row)')).toHaveText(['49', '0']);
  await expect(values(outbox, 'Lost events (row saved, no event)')).toHaveText(['0', '0']);

  const ack = await simulation(page, 'When does the consumer commit its offset?');
  await skipToEnd(ack);
  await expect(values(ack, 'Log entries')).toHaveText(['535']);
  await expect(values(ack, 'Distinct clicks')).toHaveText(['534']);
  await expect(values(ack, 'Counted twice')).toHaveText(['17']);

  await pick(ack, /^At most once/);
  await skipToEnd(ack);
  await expect(values(ack, 'Lost: committed, never counted')).toHaveText(['24']);
  await expect(values(ack, 'Counted twice')).toHaveText(['1']);

  await pick(ack, /^Effectively once/);
  await skipToEnd(ack);
  await expect(values(ack, 'Skipped: click id already counted')).toHaveText(['17']);
  await expect(values(ack, 'Counted twice')).toHaveText(['0']);
});

test('event-driven design: a dead-letter queue unblocks the partition and schema changes break strict readers', async ({
  page,
}) => {
  await page.goto('async/event-driven-design/');
  const poison = await simulation(page, 'Retry forever versus a dead-letter queue');
  await skipToEnd(poison);
  await expect(values(poison, 'Read and counted')).toHaveText(['88', '416']);
  await expect(values(poison, 'Parked in the dead-letter queue')).toHaveText(['0', '2']);
  await expect(values(poison, 'Most clicks waiting at once')).toHaveText(['335', '52']);

  await pick(poison, /^Park after 1 try/);
  await skipToEnd(poison);
  await expect(values(poison, 'Parked in the dead-letter queue')).toHaveText(['0', '12']);

  const schema = await simulation(page, 'Ship a schema change to live consumers');
  await skipToEnd(schema);
  await expect(values(schema, 'Read and counted')).toHaveText(['106', '311']);
  await expect(values(schema, 'Parked in the dead-letter queue')).toHaveText(['205', '0']);

  await pick(schema, /^Rename a field in place/);
  await skipToEnd(schema);
  await expect(values(schema, 'Parked in the dead-letter queue')).toHaveText(['205', '205']);

  await pick(schema, /^Publish the rename as v2/);
  await skipToEnd(schema);
  await expect(values(schema, 'Read and counted')).toHaveText(['311', '311']);
  await expect(values(schema, 'Events published, every topic')).toHaveText(['516', '516']);
});

test('stream processing: event time, window shapes, and watermarks', async ({ page }) => {
  await page.goto('async/stream-processing/');
  const clocks = await simulation(page, 'Processing time versus event time');
  await skipToEnd(clocks);
  await expect(values(clocks, 'Counted in the wrong window')).toHaveText(['80', '0']);
  await expect(values(clocks, 'Spike alerts that paged on-call')).toHaveText(['1', '0']);

  await pick(clocks, /^Edge region cut off/);
  await skipToEnd(clocks);
  await expect(values(clocks, 'Counted in the wrong window')).toHaveText(['60', '0']);

  await pick(clocks, /^Steady traffic/);
  await skipToEnd(clocks);
  await expect(values(clocks, 'Counted in the wrong window')).toHaveText(['20', '0']);
  await expect(values(clocks, 'Spike alerts that paged on-call')).toHaveText(['0', '0']);

  await page.getByText('Go deeper: tumbling and sliding windows side by side').click();
  const shapes = await simulation(page, 'Tumbling and sliding windows', 'Interactive');
  await expect(shapes).toContainText('Tumbling windows miss the burst');
  await expect(values(shapes, 'Highest tumbling count')).toHaveText(['32']);
  await expect(values(shapes, 'Highest sliding count')).toHaveText(['44']);
  const slider = shapes.getByRole('slider', { name: 'Sliding window shown' });
  const before = await slider.inputValue();
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).not.toHaveValue(before);
  await choose(shapes, /^Burst inside a window/);
  await expect(shapes).toContainText('Both shapes catch the burst');
  await expect(values(shapes, 'Highest tumbling count')).toHaveText(['43']);

  const watermarks = await simulation(page, 'Watermarks and late clicks');
  await skipToEnd(watermarks);
  await expect(values(watermarks, 'Late clicks dropped for good')).toHaveText(['36', '12']);
  await expect(values(watermarks, 'Mean wait for a first result')).toHaveText(['0.6 s', '3.1 s']);
  await expect(values(watermarks, 'Windows published')).toHaveText(['9', '8']);

  await pick(watermarks, /^Side table/);
  await skipToEnd(watermarks);
  await expect(values(watermarks, 'Late clicks')).toHaveText(['36', '12']);
  await expect(values(watermarks, 'Late clicks in the side table')).toHaveText(['36', '12']);
  await expect(values(watermarks, 'Clicks missing from published counts')).toHaveText(['36', '12']);
});
