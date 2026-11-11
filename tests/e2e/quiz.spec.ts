import AxeBuilder from '@axe-core/playwright';
import { expect, type Locator, type Page, test } from '@playwright/test';

const lesson = 'scaling/caching/';

async function hydrated(root: Locator) {
  await root.scrollIntoViewIfNeeded();
  await expect(root.locator('xpath=ancestor::astro-island[1]')).not.toHaveAttribute('ssr');
}

async function firstQuestion(page: Page): Promise<Locator> {
  const quiz = page.getByRole('region', { name: 'Check your understanding' });
  const item = quiz.locator('.sdv-quiz__item').first();
  await hydrated(item);
  return item;
}

async function predictNamed(page: Page, question: RegExp): Promise<Locator> {
  const predict = page.locator('.sdv-predict').filter({ has: page.getByRole('group', { name: question }) });
  await hydrated(predict);
  return predict;
}

const choiceTexts = (root: Locator) => root.locator('.sdv-choice__text').allTextContents();

test('Check answer without a choice shows an inline error linked to the question', async ({ page }) => {
  await page.goto(lesson);
  const item = await firstQuestion(page);
  const check = item.getByRole('button', { name: 'Check answer' });
  await expect(check).toBeEnabled();

  await check.click();
  const error = item.locator('.sdv-choice-error');
  await expect(error).toHaveText('Choose an answer first');
  const errorId = await error.getAttribute('id');
  await expect(check).toHaveAttribute('aria-describedby', errorId ?? '');
  await expect(item.getByRole('group')).toHaveAttribute('aria-describedby', errorId ?? '');

  await item.getByRole('radio').first().check();
  await expect(error).toBeEmpty();
  await expect(check).not.toHaveAttribute('aria-describedby');
});

test('a wrong answer moves focus to the result and marks choices with a glyph and a word', async ({
  page,
}) => {
  await page.goto(lesson);
  const item = await firstQuestion(page);
  await item.getByRole('radio', { name: /Memory compresses the links/ }).check();
  await item.getByRole('button', { name: 'Check answer' }).click();

  const result = item.getByRole('heading', { name: 'Not quite' });
  await expect(result).toBeFocused();

  const wrong = item.locator('.sdv-choice[data-state="wrong"]');
  await expect(wrong).toHaveCount(1);
  await expect(wrong).toContainText('Memory compresses the links');
  await expect(wrong.locator('.sdv-choice__status')).toHaveText('Your answer');
  await expect(wrong.locator('.sdv-choice__status svg')).toHaveCount(1);
  await expect(item.locator('.sdv-choice[data-state="correct"] .sdv-choice__status')).toHaveText(
    'Correct answer',
  );

  for (const radio of await item.getByRole('radio').all()) {
    await expect(radio).toHaveJSProperty('disabled', false);
    await expect(radio).toHaveAttribute('aria-disabled', 'true');
  }
  await item.getByRole('radio').first().focus();
  await page.keyboard.press('ArrowDown');
  await expect(item.getByRole('radio', { name: /Memory compresses the links/ })).toBeChecked();
  await expect(item.locator('.sdv-choice[data-state="wrong"]')).toContainText('Memory compresses the links');
});

test('Try again clears the answer, reorders the options and returns focus to them', async ({ page }) => {
  await page.goto(lesson);
  const quiz = page.getByRole('region', { name: 'Check your understanding' });
  const item = await firstQuestion(page);
  const before = await choiceTexts(item);

  await item.getByRole('radio').first().check();
  await item.getByRole('button', { name: 'Check answer' }).click();
  await expect(quiz.getByText('1 of 4 answered')).toBeVisible();

  await item.getByRole('button', { name: 'Try again' }).click();
  await expect(item.locator('.sdv-result')).toHaveCount(0);
  await expect(item.locator('.sdv-choice[data-state]')).toHaveCount(0);
  await expect(item.getByRole('radio').first()).toBeFocused();
  await expect(item.getByRole('radio').first()).not.toBeChecked();
  await expect(quiz.getByText('0 of 4 answered')).toBeVisible();

  const after = await choiceTexts(item);
  expect(after).not.toEqual(before);
  expect([...after].sort()).toEqual([...before].sort());
});

test('the server-rendered option order matches the hydrated order', async ({ page }) => {
  const mismatches: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydrat|did not match/i.test(message.text())) {
      mismatches.push(message.text());
    }
  });

  await page.route('**/*.js', (route) => route.abort());
  await page.goto(lesson);
  const ssr = await choiceTexts(page.locator('.sdv-quiz, .sdv-predict'));
  expect(ssr.length).toBeGreaterThan(8);

  await page.unroute('**/*.js');
  await page.reload();
  for (const island of await page.locator('.sdv-quiz, .sdv-predict').all()) {
    await hydrated(island);
  }
  expect(await choiceTexts(page.locator('.sdv-quiz, .sdv-predict'))).toEqual(ssr);
  expect(mismatches).toEqual([]);
});

test('Predict keeps a scale in sequence and focuses its result heading', async ({ page }) => {
  await page.goto(lesson);
  const scale = await predictNamed(page, /About what share of clicks/);
  const shares = await choiceTexts(scale);
  expect([
    ['About 10%', 'About 30%', 'About 70%', 'All of them'],
    ['All of them', 'About 70%', 'About 30%', 'About 10%'],
  ]).toContainEqual(shares);

  const lock = scale.getByRole('button', { name: 'Lock in my guess' });
  await lock.click();
  await expect(scale.locator('.sdv-choice-error')).toHaveText('Choose an answer first');

  await scale.getByRole('radio', { name: /About 70%/ }).check();
  await lock.click();
  const result = scale.getByRole('heading', { level: 3, name: 'You called it' });
  await expect(result).toBeFocused();
  await expect(scale.locator('.sdv-choice[data-state="correct"] .sdv-choice__status')).toHaveText(
    'Correct answer',
  );
});

for (const theme of ['dark', 'light'] as const) {
  test(`answered questions pass axe in the ${theme} theme`, async ({ page }) => {
    await page.addInitScript((value) => localStorage.setItem('starlight-theme', value), theme);
    await page.goto(lesson);
    const item = await firstQuestion(page);
    await item.getByRole('radio', { name: /Memory compresses the links/ }).check();
    await item.getByRole('button', { name: 'Check answer' }).click();
    const predict = await predictNamed(page, /fewest writes/);
    await predict.getByRole('radio', { name: /Write-through/ }).check();
    await predict.getByRole('button', { name: 'Lock in my guess' }).click();
    await expect(predict.getByRole('heading', { name: 'Surprise' })).toBeVisible();

    const results = await new AxeBuilder({ page })
      .include('.sdv-quiz')
      .include('.sdv-predict')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
}
