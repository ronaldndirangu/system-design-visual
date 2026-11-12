import { expect, type Locator, type Page, test } from '@playwright/test';

/** Opens a lesson and returns a hydrated duel, ready for Skip to the end. */
async function openDuel(page: Page, path: string, title: string) {
  await page.goto(path);
  const duel = page.getByRole('region', { name: `Simulation: ${title}` });
  await duel.scrollIntoViewIfNeeded();
  await expect(duel.getByRole('button', { name: 'Skip to the end' })).toBeEnabled();
  return duel;
}

async function finish(duel: Locator) {
  await duel.getByRole('button', { name: 'Skip to the end' }).click();
  await expect(duel.getByText('Run complete', { exact: true })).toBeVisible();
}

/** Checks the two values in a CompareTable row. Pass null to skip a column. */
async function expectRow(duel: Locator, label: string, values: [string | null, string | null]) {
  const header = duel.page().getByRole('rowheader', { name: label, exact: true });
  const row = duel.locator('tr', { has: header });
  const cells = row.locator('.sdv-stats__value');
  for (const [index, value] of values.entries()) {
    if (value !== null) await expect(cells.nth(index)).toHaveText(value);
  }
}

async function chooseByKeyboard(page: Page, duel: Locator, from: RegExp, key: string, to: RegExp) {
  await duel.getByRole('radio', { name: from }).focus();
  await page.keyboard.press(key);
  await expect(duel.getByRole('radio', { name: to })).toBeChecked();
}

test('case-studies/payments/ idempotency keys stop double charges', async ({ page }) => {
  const duel = await openDuel(page, 'case-studies/payments/', 'Same shoppers, two ways to retry');
  await expect(duel.getByRole('radio', { name: /^Slow bank/ })).toBeChecked();
  await finish(duel);
  await expectRow(duel, 'Paid, per the ledger', ['120', null]);
  await expectRow(duel, 'Retries sent', ['24', null]);
  await expectRow(duel, 'Charges at the bank', ['139', '120']);
  await expectRow(duel, 'Shoppers charged twice or more', ['17', '0']);
  await expectRow(duel, 'Extra money taken', ['$940', '$0']);
  await expectRow(duel, 'Retries answered from the key store', [null, '19']);
  await expectRow(duel, 'Bank took more than the ledger shows', ['$940', '$0']);

  await chooseByKeyboard(page, duel, /^Slow bank/, 'ArrowRight', /^Shorter timeout/);
  await expect(duel.getByText('Ready', { exact: true })).toBeVisible();
  await finish(duel);
  await expectRow(duel, 'Retries sent', ['55', null]);
  await expectRow(duel, 'Shoppers charged twice or more', ['40', '0']);
  await expectRow(duel, 'Extra money taken', ['$2,555', null]);
  await expectRow(duel, 'Unknown after 3 attempts', ['3', '3']);
  await expectRow(duel, 'Bank took more than the ledger shows', [null, '$95']);
});

test('case-studies/payments/ reconciliation settles unknown payments only from evidence', async ({
  page,
}) => {
  const duel = await openDuel(page, 'case-studies/payments/', 'Same outage, two ways to settle the books');
  await expect(duel.getByRole('radio', { name: /^Bank outage/ })).toBeChecked();
  await finish(duel);
  await expectRow(duel, 'Paid, per the ledger', ['114', '119']);
  await expectRow(duel, 'Unknown outcome now', ['6', '0']);
  await expectRow(duel, 'Completed by reconciliation', [null, '5']);
  await expectRow(duel, 'Confirmed failed by a status lookup', [null, '1']);
  await expectRow(duel, 'Bank took more than the ledger shows', ['$195', '$0']);
  await expect(
    duel.getByText(/1 payment stays unknown because the bank is still processing it/),
  ).toBeVisible();
});

test('case-studies/ticketing/ conditional writes never sell a seat twice', async ({ page }) => {
  const duel = await openDuel(page, 'case-studies/ticketing/', 'Same rush, two ways to claim a seat');
  await expect(duel.getByRole('radio', { name: /^Doors open/ })).toBeChecked();
  await finish(duel);
  await expectRow(duel, 'Tickets issued for 100 seats', ['243', '100']);
  await expectRow(duel, 'Seats promised to two or more buyers', ['70', '0']);
  await expectRow(duel, 'Writes rejected, then reread', [null, '715']);
  await expectRow(duel, 'Peak database queries per second', ['411', '1702']);

  await chooseByKeyboard(page, duel, /^Doors open/, 'ArrowRight', /^Add a waiting room/);
  await finish(duel);
  await expectRow(duel, 'Tickets issued for 100 seats', ['110', '100']);
  await expectRow(duel, 'Seats promised to two or more buyers', ['10', '0']);
  await expectRow(duel, 'Peak database queries per second', ['40', '52']);
});

test('case-studies/ticketing/ expiring holds return abandoned seats', async ({ page }) => {
  const duel = await openDuel(page, 'case-studies/ticketing/', 'Same crowd, two hold rules');
  await expect(duel.getByRole('radio', { name: /^Some buyers walk away/ })).toBeChecked();
  await finish(duel);
  await expectRow(duel, 'Tickets sold', ['73', '97']);
  await expectRow(duel, 'Seats held for buyers who left', ['27', '3']);
  await expectRow(duel, 'Holds released by expiry', [null, '40']);
  await expectRow(duel, 'Buyers told sold out', ['300', '260']);

  await duel.getByRole('radio', { name: /^Slow bank approvals/ }).check();
  await expect(duel.getByText('Ready', { exact: true })).toBeVisible();
  await finish(duel);
  await expectRow(duel, 'Tickets sold', ['90', '100']);
  await expectRow(duel, 'Holds released by expiry', ['61', '0']);
  await expectRow(duel, 'Approved payments voided', ['59', '0']);
});

test('case-studies/chat/ a per conversation sequence fixes the order', async ({ page }) => {
  const duel = await openDuel(page, 'case-studies/chat/', 'Same conversation, two ways to show it');
  await expect(duel.getByRole('radio', { name: /^Busy group chat/ })).toBeChecked();
  await finish(duel);
  await expectRow(duel, 'Shown out of order', ['25', '0']);
  await expectRow(duel, 'Held back by the reorder buffer', [null, '34']);
  await expectRow(duel, 'Longest hold in the buffer', [null, '1.7 s']);
  await expectRow(duel, 'Average delay, server to screen', ['0.6 s', '0.8 s']);
});

test('case-studies/chat/ a sync cursor recovers messages lost in a tunnel', async ({ page }) => {
  const duel = await openDuel(page, 'case-studies/chat/', 'Same tunnel, two ways to catch up');
  await expect(duel.getByRole('radio', { name: /^Phone in a tunnel/ })).toBeChecked();
  await finish(duel);
  await expectRow(duel, 'Shown on the phone', ['84', null]);
  await expectRow(duel, 'Missing from the phone', ['12', '0']);
  await expectRow(duel, 'Recovered by the catch-up', [null, '12']);
  await expectRow(duel, 'Average delay, server to screen', ['1.1 s', '1.7 s']);

  await chooseByKeyboard(page, duel, /^Phone in a tunnel/, 'ArrowRight', /^Faster heartbeats/);
  await finish(duel);
  await expectRow(duel, 'Missing from the phone', ['3', '0']);
});

test('case-studies/notifications/ a priority lane keeps codes inside the deadline', async ({ page }) => {
  const duel = await openDuel(page, 'case-studies/notifications/', 'Same codes, two ways to queue them');
  await expect(duel.getByRole('radio', { name: /^Campaign at 2 s/ })).toBeChecked();
  await finish(duel);
  await expectRow(duel, 'Missed the 5 s deadline', ['28', '0']);
  await expectRow(duel, 'Average wait, request to send', ['5.2 s', '0.0 s']);
  await expectRow(duel, 'Last campaign message sent at', ['17.0 s', '19.1 s']);

  await chooseByKeyboard(page, duel, /^Campaign at 2 s/, 'ArrowRight', /^Pay for double the rate/);
  await finish(duel);
  await expectRow(duel, 'Missed the 5 s deadline', ['5', '0']);
});

test('case-studies/notifications/ a backup provider covers an outage', async ({ page }) => {
  const duel = await openDuel(page, 'case-studies/notifications/', 'Same outage, two ways to retry');
  await expect(duel.getByRole('radio', { name: /^Primary down 5 to 15 s/ })).toBeChecked();
  await finish(duel);
  await expectRow(duel, 'Dropped at the deadline', ['15', '0']);
  await expectRow(duel, 'Sent through the backup', [null, '27']);
  await expectRow(duel, 'Failed sends to the primary', ['85', '3']);
});

test('case-studies/news-feed/ hybrid fan-out delivers the celebrity post on time', async ({ page }) => {
  const duel = await openDuel(page, 'case-studies/news-feed/', 'Same posts, two ways to fan out');
  await expect(duel.getByRole('radio', { name: /^Celebrity posts/ })).toBeChecked();
  await finish(duel);
  await expectRow(duel, 'Missed the 2 s target', ['29', '0']);
  await expectRow(duel, 'Celebrity post available to every follower after', ['10.0 s', '0.0 s']);
  await expectRow(duel, 'Feed writes run', ['7,974', '2,974']);
  await expectRow(duel, 'Lookups to serve feed loads', ['1,200', '1,520']);
  await expectRow(duel, 'Feed loads that missed the celebrity post', ['45', '0']);
  await expectRow(duel, 'Feed loads that showed the celebrity post within 1 s', ['247', '292']);
  await expect(
    duel.getByText('Posts that missed the 2 s target: fan out on write 29, hybrid fan-out 0.'),
  ).toBeVisible();
  await expect(
    duel.getByText(
      '13.0 s Fan out on write: the last of 5,000 followers gets the celebrity post in their feed, 10.0 s after it went up.',
    ),
  ).toBeVisible();
});

test('case-studies/news-feed/ hybrid fan-out needs read headroom', async ({ page }) => {
  const duel = await openDuel(page, 'case-studies/news-feed/', 'Same posts, two ways to fan out');
  await duel.getByRole('radio', { name: /^Read tier sized for push/ }).check();
  await finish(duel);
  await expectRow(duel, 'Waited more than 1 s', ['0', '996']);
  await expectRow(duel, 'Feed loads that showed the celebrity post within 1 s', ['247', '17']);
});

test('case-studies/news-feed/ fan out on read overloads the read tier at peak', async ({ page }) => {
  const duel = await openDuel(page, 'case-studies/news-feed/', 'Same feed loads, two ways to build a feed');
  await expect(duel.getByRole('radio', { name: /^Evening peak/ })).toBeChecked();
  await finish(duel);
  await expectRow(duel, 'Feed loads (same for both)', ['1,840', '1,840']);
  await expectRow(duel, 'Waited more than 1 s', ['959', '0']);
  await expectRow(duel, 'Average wait for the read tier', ['1.4 s', null]);
  await expectRow(duel, 'Lookups to serve feed loads', ['92,630', '1,840']);
  await expect(
    duel.getByText('Feed loads that waited more than 1 s: fan out on read 959, fan out on write 0.'),
  ).toBeVisible();
});

test('case-studies/payments/ Play runs the duel and Pause stops it', async ({ page }) => {
  const duel = await openDuel(page, 'case-studies/payments/', 'Same shoppers, two ways to retry');
  await duel.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(duel.getByText(/s of 30 s$/)).toBeVisible();
  await duel.getByRole('button', { name: 'Pause', exact: true }).click();
  const paused = await duel.getByText(/s of 30 s$/).textContent();
  await page.waitForTimeout(500);
  await expect(duel.getByText(/s of 30 s$/)).toHaveText(paused ?? '');
});

test('case-studies/chat/ Step advances the readout under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const duel = await openDuel(page, 'case-studies/chat/', 'Same conversation, two ways to show it');
  const table = duel.getByRole('table').first();
  const before = await table.textContent();
  for (let i = 0; i < 10; i += 1) await duel.getByRole('button', { name: 'Step' }).click();
  await expect.poll(async () => table.textContent()).not.toBe(before);
  await expect(duel.getByText(/s of \d+ s$/)).toBeVisible();
});

for (const [from, to] of [
  ['payments', 'ticketing'],
  ['ticketing', 'payments'],
  ['chat', 'notifications'],
  ['notifications', 'chat'],
] as const) {
  test(`case-studies/${from}/ links to its contrast pair ${to}`, async ({ page }) => {
    await page.goto(`case-studies/${from}/`);
    const links = page.locator(`main a[href$="case-studies/${to}/"]`);
    expect(await links.count()).toBeGreaterThan(0);
  });
}
