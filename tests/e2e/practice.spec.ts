import { expect, test } from '@playwright/test';

test('a timed round runs by keyboard and opens the rubric only after it ends', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('practice/timed-round/');
  const round = page.getByRole('region', { name: 'Interactive: Timed design round' });
  await round.scrollIntoViewIfNeeded();
  const start = round.getByRole('button', { name: 'Start round' });
  await expect(start).toBeEnabled();
  await expect(round.getByRole('heading', { name: 'Score yourself' })).toHaveCount(0);

  await start.focus();
  await page.keyboard.press('p');
  await expect(round.getByRole('button', { name: 'Pause' })).toBeFocused();
  await expect(round.getByRole('heading', { level: 4, name: /^Requirements:/ })).toBeVisible();

  await page.keyboard.press('n');
  await expect(round.getByText('Step 2 of 7')).toBeVisible();
  await expect(round.getByRole('heading', { level: 4, name: /^Estimates:/ })).toBeVisible();
  await page.keyboard.press('b');
  await expect(round.getByText('Step 1 of 7')).toBeVisible();

  await page.keyboard.press('p');
  await expect(round.getByRole('button', { name: 'Resume' })).toBeVisible();
  await expect(round.getByText('Paused. Press Resume or P to carry on.')).toBeVisible();

  await round.getByRole('button', { name: 'Finish round' }).click();
  await expect(round.getByRole('heading', { name: 'Round finished' })).toBeFocused();
  await expect(round.getByRole('heading', { name: 'Score yourself' })).toBeVisible();

  const rubric = round.getByRole('group', { name: 'Score for Requirements' });
  await rubric.getByRole('radio', { name: 'Solid' }).check();
  await expect(round.getByText(/Total 2 of 14, 1 of 7 scored/)).toBeVisible();

  const outline = round.getByRole('region', { name: /^Reference outline:/ });
  await expect(outline.getByRole('listitem')).toHaveCount(0);
  await outline.getByRole('button', { name: 'Show reference outline' }).click();
  await expect(outline.getByRole('button', { name: 'Show reference outline' })).toHaveCount(0);
  await expect(round.getByRole('heading', { level: 4, name: /^Reference outline:/ })).toBeFocused();
  await expect(outline.getByText('Requirements', { exact: true })).toBeVisible();
});

test('the round clock counts only while it runs', async ({ page }) => {
  await page.clock.install();
  await page.goto('practice/timed-round/');
  const round = page.getByRole('region', { name: 'Interactive: Timed design round' });
  await round.scrollIntoViewIfNeeded();
  const start = round.getByRole('button', { name: 'Start round' });
  await expect(start).toBeEnabled();
  await start.click();

  await page.clock.runFor(30_000);
  const stepTimer = round.getByRole('timer', { name: 'Time on this step' });
  await expect(stepTimer).toHaveText(/^0:3\d$/);

  await round.getByRole('button', { name: 'Pause' }).click();
  await expect(round.getByRole('button', { name: 'Resume' })).toBeVisible();
  const pausedAt = (await stepTimer.textContent()) ?? '';
  await page.clock.runFor(60_000);
  await expect(stepTimer).toHaveText(pausedAt);
});

test('a saved round stays on this device and can be cleared', async ({ page }) => {
  await page.goto('practice/timed-round/');
  const round = page.getByRole('region', { name: 'Interactive: Timed design round' });
  await round.scrollIntoViewIfNeeded();
  await round.getByRole('button', { name: 'Start round' }).click();
  await round.getByRole('button', { name: 'Finish round' }).click();
  await round.getByRole('button', { name: 'Save this round on this device' }).click();
  const saved = round.getByRole('button', { name: 'Round saved' });
  await expect(saved).toHaveAttribute('aria-disabled', 'true');
  await expect(saved).toBeFocused();
  await expect(page.getByText('1 saved round. Saved on this device only.')).toBeVisible();

  await page.getByRole('button', { name: 'Clear saved rounds' }).click();
  await page.getByRole('button', { name: 'Clear rounds' }).click();
  await expect(
    page.getByText('No saved rounds yet. Rounds you save stay on this device only.'),
  ).toBeVisible();
  await round.getByRole('button', { name: 'Save this round on this device' }).click();
  await expect(page.getByText('1 saved round. Saved on this device only.')).toBeVisible();

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('sdv:practice-rounds') ?? 'null'));
  expect(stored.version).toBe(1);
  expect(stored.rounds).toHaveLength(1);
  expect(stored.rounds[0].rubricTotal).toBeNull();

  await page.reload();
  await page.getByRole('region', { name: 'Interactive: Timed design round' }).scrollIntoViewIfNeeded();
  await expect(page.getByText('1 saved round. Saved on this device only.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear saved rounds' }).click();
  await page.getByRole('button', { name: 'Clear rounds' }).click();
  await expect(
    page.getByText('No saved rounds yet. Rounds you save stay on this device only.'),
  ).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('sdv:practice-rounds'))).toBeNull();
});

test('a design review flags by keyboard, replays, and reveals each fix', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('practice/design-review/');
  const review = page.getByRole('region', { name: 'Interactive: Review the flash sale design' });
  await review.scrollIntoViewIfNeeded();
  const play = review.getByRole('button', { name: 'Play replay' });
  await expect(play).toHaveJSProperty('disabled', false);
  await expect(play).toHaveAttribute('aria-disabled', 'true');

  const balancerFlag = review.getByRole('button', { name: 'Flag 1, Load balancer' });
  const cdnFlag = review.getByRole('button', { name: 'Flag 8, CDN' });
  await balancerFlag.focus();
  await page.keyboard.press('1');
  await page.keyboard.press('3');
  await page.keyboard.press('8');
  await expect(balancerFlag).toHaveAttribute('aria-pressed', 'true');
  await expect(cdnFlag).toHaveAttribute('aria-pressed', 'true');
  await expect(
    review.getByText('3 items flagged. Pick a fix for each flag, then press Play replay.'),
  ).toBeVisible();
  await expect(play).toHaveAttribute('aria-disabled', 'false');

  await page.keyboard.press('8');
  await expect(cdnFlag).toHaveAttribute('aria-pressed', 'false');

  await review
    .getByLabel('Proposed fix for Load balancer')
    .selectOption({ label: 'Run a standby pair with health checks and failover' });
  await review
    .getByLabel('Proposed fix for Product cache')
    .selectOption({ label: 'Move it to a bigger machine' });

  await play.focus();
  await page.keyboard.press('n');
  const transcript = review.getByRole('list', { name: 'Replay transcript' });
  await expect(transcript.getByRole('listitem')).toHaveCount(1);
  await expect(transcript).toContainText('Incident Minute 4, item 3, Product cache:');
  await expect(transcript).toContainText('You flagged this.');
  await expect(review.getByRole('button', { name: 'Resume' })).toBeFocused();
  await expect(review.getByLabel('Proposed fix for Product cache')).toHaveCount(0);

  await page.keyboard.press('1');
  await expect(balancerFlag).toHaveAttribute('aria-pressed', 'true');
  await expect(balancerFlag).toHaveAttribute('aria-disabled', 'true');

  await review.getByRole('button', { name: 'Reveal answers' }).click();
  await expect(review.getByRole('heading', { name: 'Review results' })).toBeFocused();
  await expect(
    review.getByText(
      'You found 2 of 6 flaws, with 0 false alarms. Your fixes match 1 of the 6 reference fixes.',
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  const balancerCard = review
    .getByRole('list', { name: 'Review items' })
    .getByRole('listitem')
    .filter({ hasText: 'Single point of failure' });
  await expect(balancerCard.getByText('Found', { exact: true })).toBeVisible();
  await expect(balancerCard.getByRole('link', { name: 'The server melts' })).toBeVisible();
  await expect(review.getByText(/Your fix: Move it to a bigger machine\./)).toBeVisible();
  await expect(review.getByRole('button', { name: 'Next event' })).toHaveAttribute('aria-disabled', 'true');

  await review.getByRole('button', { name: 'Reset' }).click();
  await expect(balancerFlag).toHaveAttribute('aria-pressed', 'false');
  await expect(review.getByText(/^Flag at least one item to start the replay\./)).toBeVisible();
  await expect(review.getByRole('heading', { name: 'Review results' })).toHaveCount(0);
});
