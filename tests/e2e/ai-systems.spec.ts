import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
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

/** Bring a simulation into view and wait until its island has hydrated. */
async function openSimulation(page: Page, title: string): Promise<Locator> {
  const sim = page.getByRole('region', { name: `Simulation: ${title}` });
  await sim.scrollIntoViewIfNeeded();
  await expect(sim.getByRole('button', { name: 'Skip to the end' })).toBeEnabled();
  return sim;
}

async function skipToEnd(sim: Locator) {
  await sim.getByRole('button', { name: 'Skip to the end' }).click();
  await expect(sim.getByText(/^Run complete/).first()).toBeVisible();
}

async function chooseScenario(sim: Locator, name: RegExp) {
  const chip = sim.getByRole('radio', { name });
  await chip.check();
  await expect(chip).toBeChecked();
}

/** A readout row, matched by the start of its header cell. */
function row(scope: Locator, label: string): Locator {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return scope.getByRole('row', { name: new RegExp(`^${escaped}`) });
}

test.describe('/ai-systems/evaluation-and-budgets', () => {
  test('the full eval set separates the candidates with the pinned numbers', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('ai-systems/evaluation-and-budgets/');
    const sim = await openSimulation(page, 'Grade three candidates on the same questions');

    await chooseScenario(sim, /Demo questions/);
    await skipToEnd(sim);
    await expect(row(sim, 'Passed the rubric')).toContainText('5 (100.0%)');
    await expect(row(sim, 'Must decline cases declined')).toContainText('none in this set');

    await chooseScenario(sim, /Full eval set/);
    await expect(row(sim, 'Passed the rubric')).toContainText('none yet');
    await skipToEnd(sim);
    const passed = row(sim, 'Passed the rubric');
    await expect(passed).toContainText('17 (70.8%)');
    await expect(passed).toContainText('21 (87.5%)');
    await expect(passed).toContainText('23 (95.8%)');
    const p95 = row(sim, 'p95 latency');
    await expect(p95).toContainText('0.80 s');
    await expect(p95).toContainText('1.50 s');
    await expect(p95).toContainText('3.01 s');
    const cost = row(sim, 'Cost per 1,000 questions');
    await expect(cost).toContainText('987');
    await expect(cost).toContainText('3,949');
    await expect(cost).toContainText('14,809');
    const verdicts = row(sim, 'Default budgets');
    await expect(verdicts).toContainText('Fits every budget');
    await expect(verdicts).toContainText('Misses p95 latency');
    expect(errors).toEqual([]);
  });

  test('budget presets move the ship decision', async ({ page }) => {
    await page.goto('ai-systems/evaluation-and-budgets/');
    const gate = page.getByRole('region', { name: 'Interactive: Set the budgets, then see who fits' });
    await gate.scrollIntoViewIfNeeded();
    const ship = row(gate, 'Ship');
    await expect(ship).toContainText('Medium');

    await chooseScenario(gate, /Tighter latency/);
    await expect(ship).toContainText('Nothing yet');

    await chooseScenario(gate, /Lowered bar/);
    await expect(ship).toContainText('Small');
  });

  test('steps by keyboard with reduced motion and stays axe clean in dark mode', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.goto('ai-systems/evaluation-and-budgets/');
    const sim = await openSimulation(page, 'Grade three candidates on the same questions');
    const graded = row(sim, 'Questions graded');
    await expect(graded).toContainText('0');
    await sim.getByRole('button', { name: 'Step' }).focus();
    await page.keyboard.press('Enter');
    await page.keyboard.press('Enter');
    await expect(sim.getByText(/^Question 2 of|^Run complete/)).toBeVisible();
    await skipToEnd(sim);
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe('/ai-systems/gateway', () => {
  const pipeline = 'Requests from three stores through one gateway';

  test('per store quotas protect the quiet stores from a noisy tenant', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('ai-systems/gateway/');
    const sim = await openSimulation(page, pipeline);
    await chooseScenario(sim, /^Noisy tenant/);
    await skipToEnd(sim);
    await expect(sim.getByText('Run complete: 217 failed requests', { exact: true })).toBeVisible();
    await expect(row(sim, 'Arrived').getByRole('cell').last()).toHaveText('617');
    await expect(row(sim, 'Accounted for').getByRole('cell').last()).toHaveText('617');
    const shared = row(sim, 'Failed: shared rate limit');
    await expect(shared.getByRole('cell').nth(1)).toHaveText('27');
    await expect(shared.getByRole('cell').last()).toHaveText('217');

    const policies = sim.getByRole('switch', { name: /^Gateway policies/ });
    await policies.focus();
    await page.keyboard.press('Space');
    await expect(policies).toBeChecked();
    await expect(sim.getByText('Ready', { exact: true })).toBeVisible();
    await skipToEnd(sim);
    await expect(sim.getByText('Run complete: no failed requests', { exact: true })).toBeVisible();
    const shed = row(sim, 'Shed by quota');
    await expect(shed.getByRole('cell').first()).toHaveText('261');
    await expect(shed.getByRole('cell').nth(1)).toHaveText('0');
    await expect(row(sim, 'Failed: shared rate limit').getByRole('cell').last()).toHaveText('0');
    expect(errors).toEqual([]);
  });

  test('the cascade wins on cost and misses the latency budget on easy questions', async ({ page }) => {
    await page.goto('ai-systems/gateway/');
    const sim = await openSimulation(page, 'Routing versus a cascade on the same questions');
    await chooseScenario(sim, /^Mostly easy questions/);
    await skipToEnd(sim);
    const passed = row(sim, 'Passed the rubric');
    await expect(passed).toContainText('53 (88.3%)');
    await expect(passed).toContainText('59 (98.3%)');
    await expect(row(sim, 'p95 latency')).toContainText('2.31 s');
    const cost = row(sim, 'Cost per 1,000 requests');
    await expect(cost).toContainText('1,870');
    await expect(cost).toContainText('1,709');
    await expect(cost).toContainText('3,949');
    const verdicts = row(sim, 'Lesson 1 budgets').getByRole('cell');
    await expect(verdicts.first()).toHaveText('Fits every budget');
    await expect(verdicts.nth(1)).toContainText('Misses');
  });

  test('dropping the store from the cache key serves the wrong policy', async ({ page }) => {
    await page.goto('ai-systems/gateway/');
    const widget = page.getByRole('region', { name: 'Interactive: Two caches: answers versus prompt work' });
    await widget.scrollIntoViewIfNeeded();
    await expect(widget.getByText('Every hit is the right answer', { exact: true })).toBeVisible();
    const store = widget.getByRole('switch', { name: 'Store (tenant)' });
    await expect(store).toBeEnabled();
    await store.focus();
    await page.keyboard.press('Space');
    await expect(store).not.toBeChecked();
    await expect(widget.getByText('1 wrong answer served', { exact: true })).toBeVisible();
    await expect(row(widget, 'Wrong hits')).toContainText('1');

    await widget.getByRole('radio', { name: 'Prefix (KV) cache' }).check();
    await expect(row(widget, 'Reused blocks')).toContainText('22 of 25');
    await expect(row(widget, 'Time to first token')).toContainText('0.13 s');
  });

  test('steps by keyboard with reduced motion and stays axe clean in dark mode', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.goto('ai-systems/gateway/');
    const sim = await openSimulation(page, pipeline);
    await sim.getByRole('button', { name: 'Step' }).focus();
    await page.keyboard.press('Enter');
    await expect(sim.getByText('0.1 s of 30.0 s', { exact: true })).toBeVisible();
    await skipToEnd(sim);
    const cascade = await openSimulation(page, 'Routing versus a cascade on the same questions');
    await skipToEnd(cascade);
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe('/ai-systems/retrieval', () => {
  const hybrid = 'Fuse keyword and vector search with RRF';

  /** The hybrid search ends on a verdict, so wait for its comparison table instead of Run complete. */
  async function finishSearch(sim: Locator) {
    await sim.getByRole('button', { name: 'Skip to the end' }).click();
    await expect(row(sim, 'Rank of the right chunk')).toBeVisible();
  }

  test('no filter leaks the other store and the pre-filter cites only Harbor', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('ai-systems/retrieval/');
    const sim = await openSimulation(page, hybrid);
    await chooseScenario(sim, /^Sale item return/);
    const citations = sim.getByRole('list', { name: 'Citations' });

    await sim.getByRole('radio', { name: 'No filter', exact: true }).check();
    await finishSearch(sim);
    await expect(citations.getByRole('listitem')).toHaveCount(2);
    await expect(citations).toContainText('[pine-returns]');
    await expect(citations).toContainText('Another store');
    await expect(
      sim.getByText('Leak: the model saw 1 chunk this customer may not read', { exact: true }).first(),
    ).toBeVisible();

    await sim.getByRole('radio', { name: 'Pre-filter', exact: true }).check();
    await finishSearch(sim);
    await expect(citations.getByRole('listitem')).toHaveCount(1);
    await expect(citations).toHaveText('[harbor-returns-1]');
    await expect(sim.getByText('Grounded in the right chunk', { exact: true }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the post-filter drops chunks and abstains on an answerable paraphrase', async ({ page }) => {
    await page.goto('ai-systems/retrieval/');
    const sim = await openSimulation(page, hybrid);
    await chooseScenario(sim, /^Paraphrase/);
    await sim.getByRole('radio', { name: 'Post-filter', exact: true }).check();
    await finishSearch(sim);
    await expect(sim.getByText('Dropped by post-filter', { exact: true })).toHaveCount(2);
    await expect(
      sim.getByText('Wrong abstention: the policy has the answer', { exact: true }).first(),
    ).toBeVisible();
    await expect(row(sim, 'Result').getByRole('cell').last()).toHaveText('Wrong');
  });

  test('overlap keeps the sale exception with the rule', async ({ page }) => {
    await page.goto('ai-systems/retrieval/');
    const widget = page.getByRole('region', { name: 'Interactive: Where does the exception land?' });
    await widget.scrollIntoViewIfNeeded();
    await expect(
      widget.getByText('Exception missing from the sent chunk', { exact: true }).first(),
    ).toBeVisible();
    await expect(row(widget, 'Fixture answer')).toContainText('Wrong');
    await expect(row(widget, 'Chunks')).toContainText('3');

    await chooseScenario(widget, /^16 words, overlap 8/);
    await expect(widget.getByText('Exception is in the sent chunk', { exact: true }).first()).toBeVisible();
    await expect(row(widget, 'Fixture answer')).toContainText('Correct');
    await expect(row(widget, 'Chunks')).toContainText('5');
  });

  test('a higher evidence bar trades the last wrong answer for a handoff', async ({ page }) => {
    await page.goto('ai-systems/retrieval/');
    const widget = page.getByRole('region', { name: 'Interactive: Set the evidence bar' });
    await widget.scrollIntoViewIfNeeded();
    await expect(row(widget, 'Correct answers')).toContainText('7 of 12');
    await expect(row(widget, 'Wrong answers')).toContainText('1 of 12');
    await expect(row(widget, 'Abstentions')).toContainText('4 of 12');
    await expect(row(widget, 'Abstentions')).toContainText('3 of 4');

    const slider = widget.getByRole('slider', { name: 'Evidence threshold' });
    await expect(slider).toBeEnabled();
    await slider.focus();
    await page.keyboard.press('ArrowRight');
    await expect(widget.getByText('No wrong answers at 0.85', { exact: true })).toBeVisible();
    await expect(row(widget, 'Correct answers')).toContainText('6 of 12');
    await expect(row(widget, 'Abstentions')).toContainText('6 of 12');
  });

  test('steps by keyboard with reduced motion and stays axe clean in dark mode', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.goto('ai-systems/retrieval/');
    const sim = await openSimulation(page, hybrid);
    await sim.getByRole('button', { name: 'Step' }).focus();
    await page.keyboard.press('Enter');
    await expect(sim.getByText(/^Stage 1 of \d+$/).first()).toBeVisible();
    await finishSearch(sim);
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe('/ai-systems/llm-serving', () => {
  test('continuous batching beats static batching on mixed lengths', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('ai-systems/llm-serving/');
    const sim = await openSimulation(page, 'Static batching against continuous batching');
    await chooseScenario(sim, /^Mixed lengths/);
    await skipToEnd(sim);
    const ttft = row(sim, 'Time to first token, median');
    await expect(ttft).toContainText('201 ms');
    await expect(ttft).toContainText('17 ms');
    const idle = row(sim, 'Idle slot steps while requests wait');
    await expect(idle.getByRole('cell').first()).toHaveText(/179/);
    await expect(idle.getByRole('cell').last()).toHaveText(/^0/);
    expect(errors).toEqual([]);
  });

  test('paged blocks preempt under a memory squeeze', async ({ page }) => {
    await page.goto('ai-systems/llm-serving/');
    const sim = await openSimulation(page, 'Reserving the maximum against paged blocks');
    await chooseScenario(sim, /^Memory squeeze/);
    await expect(sim.getByText('Ready', { exact: true })).toBeVisible();
    await skipToEnd(sim);
    await expect(row(sim, 'Preemptions').getByRole('cell').last()).toHaveText(/^2/);
    await expect(row(sim, 'Tokens recomputed after preemption').getByRole('cell').last()).toHaveText(/^183/);
  });

  test('chunked prefill shortens the longest wait between tokens', async ({ page }) => {
    await page.goto('ai-systems/llm-serving/');
    const sim = await openSimulation(page, 'One long prompt, with and without chunked prefill');
    await skipToEnd(sim);
    const gap = row(sim, 'Longest wait between tokens');
    await expect(gap).toContainText('34 ms');
    await expect(gap).toContainText('11 ms');
    await expect(row(sim, 'R7 (long prompt) time to first token')).toContainText('197 ms');

    const budget = sim.getByRole('radio', { name: '256 tokens' });
    await budget.check();
    await expect(sim.getByText('Ready', { exact: true })).toBeVisible();
    await skipToEnd(sim);
    await expect(row(sim, 'Longest wait between tokens').getByRole('cell').last()).toHaveText(/^11 ms/);
    await expect(row(sim, 'R7 (long prompt) time to first token')).toContainText('55 ms');
  });

  test('steps by keyboard with reduced motion and stays axe clean in dark mode', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.goto('ai-systems/llm-serving/');
    const sim = await openSimulation(page, 'Static batching against continuous batching');
    await sim.getByRole('button', { name: 'Step' }).focus();
    await page.keyboard.press('Enter');
    await expect(sim.getByText(/^Step 1 of/)).toBeVisible();
    await skipToEnd(sim);
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe('/ai-systems/agents', () => {
  const title = 'Two agents, same model, same fixture trace';

  test('the injected ticket fools only the unguarded agent', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('ai-systems/agents/');
    const sim = await openSimulation(page, title);
    await chooseScenario(sim, /Injected ticket/);
    await skipToEnd(sim);
    await expect(sim.getByText('Run complete', { exact: true })).toBeVisible();
    const refunds = row(sim, 'Refunds issued');
    await expect(refunds).toContainText('($544)');
    await expect(refunds.getByRole('cell').last()).toHaveText('0');
    await expect(row(sim, 'Blocked by policy').getByRole('cell').last()).toHaveText('1');
    await expect(row(sim, 'Waiting for approval').getByRole('cell').last()).toHaveText('1');
    await expect(row(sim, 'Unauthorized side effects').getByRole('cell').last()).toHaveText('None');
    expect(errors).toEqual([]);
  });

  test('the budget stops a runaway loop and a guard toggle restarts the run', async ({ page }) => {
    await page.goto('ai-systems/agents/');
    const sim = await openSimulation(page, title);
    await chooseScenario(sim, /Runaway loop/);
    await skipToEnd(sim);
    await expect(row(sim, 'Tool calls used')).toContainText('30, no cap');
    await expect(row(sim, 'Tool calls used')).toContainText('8 of 8');
    await expect(row(sim, 'Cost units (illustrative)')).toContainText('124 units, no cap');

    const budget = sim.getByRole('switch', { name: 'Step and cost budget' });
    await budget.focus();
    await page.keyboard.press('Space');
    await expect(budget).not.toBeChecked();
    await expect(sim.getByText('Ready', { exact: true })).toBeVisible();
    await skipToEnd(sim);
    await expect(row(sim, 'Tool calls used').getByRole('cell').last()).toHaveText('30, no cap');
  });

  test('steps by keyboard with reduced motion and stays axe clean in dark mode', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.goto('ai-systems/agents/');
    const sim = await openSimulation(page, title);
    await chooseScenario(sim, /Customer cancels/);
    await sim.getByRole('button', { name: 'Step' }).focus();
    await page.keyboard.press('Enter');
    await expect(sim.getByText('Step 1 of 8', { exact: true })).toBeVisible();
    await skipToEnd(sim);
    await expect(row(sim, 'Cancelled').getByRole('cell').last()).toHaveText('1');
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe('/ai-systems/recommendations', () => {
  const title = 'Narrow 3,000,000 items to five replacements';

  async function finishRun(sim: Locator) {
    const skip = sim.getByRole('button', { name: 'Skip to the end' });
    await skip.click();
    await expect(skip).toBeDisabled();
  }

  test('the funnel fits the budget and the scoreboard compares finished runs', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('ai-systems/recommendations/');
    const sim = await openSimulation(page, title);

    await chooseScenario(sim, /^Score everything/);
    await finishRun(sim);
    await expect(row(sim, 'Total time so far')).toContainText('30,001 ms');

    await chooseScenario(sim, /^Funnel/);
    await expect(sim.getByText('Ready', { exact: true })).toBeVisible();
    await finishRun(sim);
    await expect(row(sim, 'Total time so far')).toContainText('14.87 ms');
    await expect(row(sim, 'Candidate generation')).toContainText('487');

    const board = sim.getByRole('table', { name: /^Scenarios you have finished/ });
    await expect(row(board, 'Verdict')).toContainText('Over budget');
    await expect(row(board, 'Verdict')).toContainText('Fits 50 ms, 5 of 5 good');
    expect(errors).toEqual([]);
  });

  test('too few candidates is fast but misses good items', async ({ page }) => {
    await page.goto('ai-systems/recommendations/');
    const sim = await openSimulation(page, title);
    await chooseScenario(sim, /^Too few candidates/);
    await finishRun(sim);
    await expect(sim.getByText('Fast, but 3 of 5 good', { exact: true }).first()).toBeVisible();
    await expect(row(sim, 'Total time so far')).toContainText('7.24 ms');
  });

  test('the candidate slider trades recall for time', async ({ page }) => {
    await page.goto('ai-systems/recommendations/');
    const frame = page.getByRole('region', {
      name: 'Interactive: How many candidates should the ranker see?',
    });
    await frame.scrollIntoViewIfNeeded();
    const slider = frame.getByRole('slider', { name: 'Candidates sent to the ranker' });
    await expect(slider).toBeEnabled();
    await expect(row(frame, 'Total time')).toContainText('14.87 ms');

    await slider.focus();
    await page.keyboard.press('End');
    await expect(row(frame, 'Candidates requested')).toContainText('20,000');
    await expect(frame.getByText('Over the 50 ms budget', { exact: true }).first()).toBeVisible();

    await page.keyboard.press('Home');
    await expect(row(frame, 'Candidates requested')).toContainText('10');
    await expect(frame.getByText('Fast, but misses good items', { exact: true }).first()).toBeVisible();
  });

  test('steps by keyboard with reduced motion and stays axe clean in dark mode', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.goto('ai-systems/recommendations/');
    const sim = await openSimulation(page, title);
    await chooseScenario(sim, /^Funnel/);
    await sim.getByRole('button', { name: 'Step' }).focus();
    await page.keyboard.press('Enter');
    await expect(sim.getByText(/^Stage 1 of/).first()).toBeVisible();
    await expect(row(sim, 'Candidate generation')).toContainText('487');
    await finishRun(sim);
    expect(await axeViolations(page)).toEqual([]);
  });
});

test.describe('/ai-systems/support-assistant', () => {
  const title = 'Two support assistants, one set of requests';

  test('the leak probe harms only the prototype', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('ai-systems/support-assistant/');
    const sim = await openSimulation(page, title);
    await chooseScenario(sim, /Tenant leak probe/);
    await skipToEnd(sim);
    await expect(row(sim, 'Answers with a citation')).toContainText('0 of 6');
    await expect(row(sim, 'Answers with a citation')).toContainText('4 of 4');
    await expect(row(sim, 'Harms')).toContainText('4 leaks');
    const verdict = row(sim, 'Verdict');
    await expect(verdict).toContainText('4 harms');
    await expect(verdict).toContainText('No harms');
    expect(errors).toEqual([]);
  });

  test('scenarios reset the run and pin their results', async ({ page }) => {
    await page.goto('ai-systems/support-assistant/');
    const sim = await openSimulation(page, title);

    await chooseScenario(sim, /Weak evidence/);
    await expect(sim.getByText('Ready', { exact: true })).toBeVisible();
    await skipToEnd(sim);
    await expect(row(sim, 'Harms')).toContainText('4 unsupported answers');
    await expect(row(sim, 'Handed to staff')).toContainText('4');

    await chooseScenario(sim, /Refund requests/);
    await expect(sim.getByText('Ready', { exact: true })).toBeVisible();
    await skipToEnd(sim);
    await expect(row(sim, 'Money refunded wrongly')).toContainText('$697');
    await expect(row(sim, 'Money refunded wrongly')).toContainText('$0');
    await expect(row(sim, 'Harms')).toContainText('3 wrong refunds');

    await chooseScenario(sim, /Budget runs out/);
    await skipToEnd(sim);
    await expect(row(sim, 'Refused for budget')).toContainText('3');
    await expect(row(sim, 'Model units spent')).toContainText('Harbor 15, Pine 3');
    await expect(row(sim, 'Model units spent')).toContainText('Harbor 9, Pine 9');
    await expect(row(sim, 'Harms')).toContainText('2 starved requests');
  });

  test('steps by keyboard with reduced motion and stays axe clean in dark mode', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.goto('ai-systems/support-assistant/');
    const sim = await openSimulation(page, title);
    await sim.getByRole('button', { name: 'Step' }).focus();
    await page.keyboard.press('Enter');
    await expect(sim.getByText(/^Request 1 of/)).toBeVisible();
    await expect(row(sim, 'Requests handled')).toContainText('1');
    await skipToEnd(sim);
    expect(await axeViolations(page)).toEqual([]);
  });

  test('the quiz explains a wrong answer', async ({ page }) => {
    await page.goto('ai-systems/support-assistant/');
    const quiz = page.getByRole('region', { name: 'Check your understanding' });
    await quiz.scrollIntoViewIfNeeded();
    const first = quiz.getByRole('group').first();
    const option = first.getByRole('radio').first();
    await expect(option).toBeEnabled();
    await option.check();
    await quiz.getByRole('button', { name: 'Check answer' }).first().click();
    await expect(quiz.getByText(/^(Correct|Not quite)$/).first()).toBeVisible();
    await quiz.getByText('Why each option is right or wrong').first().click();
    await expect(quiz.getByText(/^(Right|Wrong): /).first()).toBeVisible();
  });
});
