import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import legacy from '../../scripts/lesson-lint-legacy.json';
import {
  conceptWords,
  countH2,
  type LintIssue,
  lessonKind,
  linkedLessons,
  lintConcept,
  lintLesson,
  questionIds,
} from '../../scripts/lint-lessons';
import { CONCEPT_WORD_BUDGET, concept, concepts } from '../../src/data/concepts';
import { allLessons, type Lesson } from '../../src/data/curriculum';
import { computeMinutes, corePath } from '../../src/lib/minutes';

const known = new Set(['m/a', 'm/b', 'm/c', 'n/d', 'm/self']);
const prose = (words: number) => Array.from({ length: words }, () => 'word').join(' ');

function page(sections: string[]): string {
  return ['---', 'title: Fixture', '---', '', ...sections].join('\n\n');
}

const template = [
  '<Recall lessons={["m/a"]} />',
  '<Objectives>Goals</Objectives>',
  '## One',
  '<Predict id="m/self/predict-1" question="Guess?" options={["a", "b"]} answer={0}>Reveal</Predict>',
  '## Two',
  `See [a](../a/), [b](../b/) and [d](../../n/d/). ${prose(1500)}`,
  '## Three',
  '## Four',
  '## Five',
  '<KeyTakeaways>Points</KeyTakeaways>',
  "export const quiz = [\n  { id: 'm/self/q1', prompt: 'P', options: [] },\n];",
  '<Quiz questions={quiz} />',
  '<Challenge>Try it</Challenge>',
];

function fixture(sections: string[], overrides: Partial<Lesson> = {}) {
  const mdx = page(sections);
  const lesson: Lesson = {
    id: 'm/self',
    title: 'Fixture',
    summary: 'Fixture',
    minutes: computeMinutes(mdx),
    difficulty: 1,
    advanced: false,
    buildsOn: ['m/a'],
    ...overrides,
  };
  return lintLesson(lesson, mdx, known);
}

const rules = (issues: LintIssue[]) => issues.map((issue) => issue.rule);

describe('lesson lint', () => {
  it('passes a lesson that follows the template', () => {
    expect(fixture(template)).toEqual([]);
  });

  it('flags sections out of template order', () => {
    const swapped = template.filter((section) => !section.startsWith('<KeyTakeaways'));
    swapped.push('<KeyTakeaways>Late</KeyTakeaways>');
    expect(fixture(swapped)).toEqual([
      expect.objectContaining({
        rule: 'order',
        message: expect.stringMatching(/^Quiz comes before KeyTakeaways/),
      }),
    ]);
  });

  it('requires Recall only when the lesson builds on another', () => {
    const noRecall = template.filter((section) => !section.startsWith('<Recall'));
    expect(fixture(noRecall)).toEqual([{ rule: 'required', message: 'add a Recall section' }]);
    expect(fixture(noRecall, { buildsOn: undefined })).toEqual([]);
  });

  it('counts only core path simulations, words and h2 headings', () => {
    const sims = ['<AWidget />', '<BWidget />', '<CWidget />'].join('\n');
    const imports = [
      "import AWidget from '../../components/widgets/AWidget';",
      "import BWidget from '../../components/widgets/BWidget';",
      "import CWidget from '../../components/widgets/CWidget';",
    ].join('\n');
    expect(rules(fixture([imports, ...template, sims]))).toEqual(['sims']);
    expect(
      fixture([imports, ...template, `<details>\n<summary>Go deeper</summary>\n\n${sims}\n</details>`]),
    ).toEqual([]);
    expect(rules(fixture([...template, prose(1200)]))).toEqual(['words']);
    expect(rules(fixture([...template, '## Six', '## Seven', '## Eight', '## Nine']))).toEqual(['h2']);
  });

  it('flags declared minutes outside the tolerance', () => {
    const declared = Math.round(computeMinutes(page(template)) * 2);
    expect(rules(fixture(template, { minutes: declared }))).toEqual(['minutes']);
  });

  it('needs three lesson links, one of them to a lesson it builds on', () => {
    expect(rules(fixture(template, { buildsOn: ['m/c'] }))).toEqual(['links']);
    const fewer = template.map((section) => section.replace('[d](../../n/d/)', '[d](https://example.com/)'));
    expect(rules(fixture(fewer))).toEqual(['links']);
  });

  it('flags duplicate question ids and ids outside the lesson', () => {
    const duplicate = template.map((section) => section.replace('m/self/predict-1', 'm/self/q1'));
    expect(fixture(duplicate)).toEqual([{ rule: 'ids', message: 'question id "m/self/q1" appears twice' }]);
    const foreign = template.map((section) => section.replace('m/self/q1', 'm/other/q1'));
    expect(rules(fixture(foreign))).toEqual(['ids']);
  });

  it('classifies cards, case studies and practice pages', () => {
    expect(lessonKind({ id: 'thinking/design-checklist', format: 'card' })).toBe('card');
    expect(lessonKind({ id: 'case-studies/chat' })).toBe('case-study');
    expect(lessonKind({ id: 'practice/timed-round' })).toBe('practice');
    expect(lessonKind({ id: 'scaling/caching' })).toBe('lesson');
  });

  it('strips nested details blocks from the core path', () => {
    const mdx = 'a <details>b <details>c</details> d</details> e <details>f</details> g';
    expect(corePath(mdx)).toBe('a  e  g');
  });

  it('ignores headings inside code fences', () => {
    expect(countH2('## Real\n```md\n## Fake\n```\n## Also real\n### Smaller')).toBe(2);
  });

  it('resolves relative links the way the browser does', () => {
    const mdx =
      '[a](../a/) [again](../a/#part) [d](../../n/d/) [self](../self/) [x](https://x.dev/) [top](#top) <a href="../b/">b</a>';
    expect(linkedLessons(mdx, 'm/self', known).sort()).toEqual(['m/a', 'm/b', 'n/d']);
  });

  it('reads question ids from Quiz and Recall arrays and Predict tags', () => {
    expect(questionIds(page(template))).toEqual(['m/self/q1', 'm/self/predict-1']);
  });

  it('ignores ids in diagram exports', () => {
    const diagram = ["export const nodes = [{ id: 'a' }, { id: 'b' }];", '<StepDiagram nodes={nodes} />'];
    expect(fixture([...template, ...diagram])).toEqual([]);
  });
});

describe('lesson lint gate', () => {
  const legacyIds = new Set<string>(legacy);

  it('lists only real lessons as legacy', () => {
    const lessonIds = new Set(allLessons.map((lesson) => lesson.id));
    expect([...legacyIds].filter((id) => !lessonIds.has(id))).toEqual([]);
  });

  it('holds every lesson outside the legacy list to the template', () => {
    const failures = allLessons
      .filter((lesson) => !legacyIds.has(lesson.id))
      .flatMap((lesson) => {
        const mdx = readFileSync(new URL(`../../src/content/docs/${lesson.id}.mdx`, import.meta.url), 'utf8');
        return lintLesson(lesson, mdx).map((issue) => `${lesson.id} [${issue.rule}] ${issue.message}`);
      });
    expect(failures).toEqual([]);
  });
});

describe('concept lint', () => {
  const entry = concept('cache');
  const page = (slug = entry.slug, title = entry.title) =>
    `---\ntitle: ${title}\ndescription: ${entry.definition}\ntableOfContents: false\n---\n\nimport ConceptPage from '../../../components/concepts/ConceptPage.astro';\n\n<ConceptPage slug="${slug}" />\n`;
  const [q1, q2] = entry.quiz;
  if (!q1 || !q2) throw new Error('cache needs two quiz questions');

  it('counts quiz prompts and options but skips explanations the reader sees only after answering', () => {
    const words = conceptWords(entry, page());
    const longWhy = entry.quiz.map((q) => ({
      ...q,
      options: q.options.map((o) => ({ ...o, why: prose(80) })),
    }));
    expect(conceptWords({ ...entry, quiz: longWhy }, page())).toBe(words);
    expect(
      conceptWords({ ...entry, quiz: [{ ...q1, prompt: `${q1.prompt} ${prose(5)}` }, q2] }, page()),
    ).toBe(words + 5);
    expect(conceptWords(entry, `${page()}\n${prose(10)}\n`)).toBe(words + 10);
  });

  it('flags long text, wrong counts, bad quiz ids, off-site links and a page that skips the wrapper', () => {
    const broken = {
      ...entry,
      definition: prose(26),
      analogy: prose(26),
      steps: [prose(21), ...entry.steps.slice(1)],
      example: { title: prose(30), lines: [prose(31)] },
      variants: entry.variants.slice(0, 1).map((variant) => ({ ...variant, caption: prose(13) })),
      quiz: [{ ...q1, id: 'concepts/cache/one' }],
      learnMore: [{ course: 'karan' as const, href: 'https://example.com/caching', label: 'Caching' }],
    };
    const messages = lintConcept(broken, `${page('cdn', 'Caches')}${prose(CONCEPT_WORD_BUDGET)}`).map(
      (issue) => `[${issue.rule}] ${issue.message}`,
    );
    expect(messages).toEqual([
      expect.stringMatching(/^\[words\] \d+ visible words/),
      '[words] definition has 26 words; keep it at 25 or fewer',
      '[words] analogy has 26 words; keep it at 25 or fewer',
      '[words] step 1 has 21 words; keep it at 20 or fewer',
      '[words] example has 61 words; keep it at 60 or fewer',
      expect.stringMatching(/^\[words\] "Cache-aside" caption has 13 words/),
      '[shape] 1 variants; use 2 to 3',
      '[shape] 1 quiz questions; use 2',
      '[shape] 1 learn more links; use 2 to 3',
      '[ids] question id "concepts/cache/one" should be "concepts/cache/q1"',
      expect.stringMatching(/^\[links\] https:\/\/example\.com\/caching is not on a System Design site/),
      '[page] render the page with <ConceptPage slug="cache" />',
      '[page] frontmatter title should be "Cache"',
      '[page] frontmatter description should match the definition',
    ]);
  });

  it('holds every shipped concept page to the template', () => {
    const failures = concepts.flatMap((entry) => {
      const mdx = readFileSync(
        new URL(`../../src/content/docs/concepts/${entry.slug}.mdx`, import.meta.url),
        'utf8',
      );
      return lintConcept(entry, mdx).map((issue) => `${entry.slug} [${issue.rule}] ${issue.message}`);
    });
    expect(failures).toEqual([]);
  });
});
