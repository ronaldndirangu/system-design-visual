import { expect, test } from '@playwright/test';
import { curriculum } from '../../src/data/curriculum';
import { topicGroups } from '../../src/data/topics';
import { documentOverflow, island } from './helpers';

test('mobile navigation separates study, practice and quick lookup without duplicate destinations', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('topics/');
  await page.getByRole('button', { name: 'Menu' }).click();
  const nav = page.locator('#starlight__sidebar');
  const destinations = await nav
    .locator('a[href]')
    .evaluateAll((anchors) => anchors.map((a) => a.getAttribute('href')));
  expect(new Set(destinations).size).toBe(destinations.length);
  const practice = nav
    .locator('summary')
    .filter({ hasText: /^8\. Practice$/ })
    .locator('..');
  await expect(practice).toHaveAttribute('open', '');
  await expect(practice.getByRole('link', { name: 'Interview preparation', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(nav.getByText('Review and reference', { exact: true })).toHaveCount(0);
  for (const label of ['Start here', 'Learning paths', 'Course map', 'Review queue']) {
    const link = nav.getByRole('link', { name: label, exact: true });
    await expect(link).toBeVisible();
    expect((await link.boundingBox())?.y).toBeLessThan(450);
  }
});

test('interview preparation retains every prompt behind keyboard-accessible disclosures', async ({
  page,
}) => {
  await page.goto('topics/');
  const topics = page.locator('.sdv-topics__topic');
  await expect(topics).toHaveCount(topicGroups.flatMap((group) => group.topics).length);
  await expect(page.locator('.sdv-topics__topic[open]')).toHaveCount(0);
  await topics.first().locator('summary').focus();
  await page.keyboard.press('Enter');
  await expect(topics.first()).toHaveAttribute('open', '');
  await expect(topics.first().getByRole('link', { name: 'Shortener at scale', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Start a timed practice round' })).toHaveAttribute(
    'href',
    /practice\/timed-round\/$/,
  );
  await expect(page.locator('.pagination-links a')).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 844 });
  expect(await documentOverflow(page)).toBe(0);
});

test('module summaries remain accessible from the course map on their existing URLs', async ({
  page,
  request,
}) => {
  await page.goto('curriculum/');
  const links = page.locator('.sdv-map__summary-link a');
  await expect(links).toHaveCount(curriculum.length);
  for (const [index, module] of curriculum.entries()) {
    await expect(links.nth(index)).toHaveAttribute(
      'href',
      `/system-design-visual/cheat-sheets/${module.id}/`,
    );
    expect((await request.get(`cheat-sheets/${module.id}/`)).status()).toBe(200);
  }
  await links.filter({ hasText: 'Scaling systems' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Module summary: Scaling systems');
  await expect(
    page.getByRole('link', { name: 'Check your understanding with the module checkpoint.' }),
  ).toHaveAttribute('href', /checkpoints\/scaling\/$/);
  await expect(page.locator('.pagination-links a')).toHaveCount(0);
});

test('lessons have one completion control and one next action even after the quiz', async ({
  page,
  request,
}) => {
  const bank = await (await request.get('question-bank.json')).json();
  await page.goto('scaling/caching/');
  const quiz = page.getByRole('region', { name: 'Check your understanding', exact: true });
  await island(quiz);
  const questions: { options: { text: string; correct?: boolean }[] }[] = bank['scaling/caching'].questions;
  for (const [index, question] of questions.entries()) {
    const correct = question.options.find((option) => option.correct);
    if (!correct) throw new Error('Quiz question has no correct answer');
    const item = quiz.locator('.sdv-quiz__item').nth(index);
    await item
      .locator('label')
      .filter({ has: page.getByText(correct.text, { exact: true }) })
      .getByRole('radio')
      .check();
    await item.getByRole('button', { name: 'Check answer' }).click();
  }
  await expect(page.getByRole('button', { name: /^Mark( lesson)? complete$/ })).toHaveCount(1);
  await expect(page.locator('main').getByRole('link', { name: /^Next:/ })).toHaveCount(1);
  await expect(page.locator('.pagination-links a[rel="next"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Mark lesson complete', exact: true }).click();
  await expect(page.locator('.sdv-complete')).toContainText('You finished');
  await page.goto('scaling/consistent-hashing/');
  await expect(page.locator('main').getByRole('link', { name: /^Next:/ })).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Review the module summary' })).toHaveAttribute(
    'href',
    /cheat-sheets\/scaling\/$/,
  );
  await expect(page.locator('details.sdv-reading')).not.toHaveAttribute('open');
  await page.locator('details.sdv-reading summary').click();
  await expect(page.locator('.sdv-reading__list a').first()).toBeVisible();
});

test.describe('no JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('reference and preparation disclosures remain usable without script', async ({ page }) => {
    await page.goto('topics/');
    const topic = page.locator('.sdv-topics__topic').first();
    await topic.locator('summary').click();
    await expect(topic.getByRole('link').first()).toBeVisible();
    await page.goto('scaling/caching/');
    await page.locator('details.sdv-reading summary').click();
    await expect(page.locator('.sdv-reading__list a').first()).toBeVisible();
    await expect(page.locator('.sdv-complete').getByRole('link', { name: /^Next:/ })).toBeVisible();
  });
});
