import type { APIRoute } from 'astro';
import type { QuestionBank } from '../components/review/ReviewQueue';
import { findLesson, findModule } from '../data/curriculum';
import { lessonHref, withBase } from '../lib/paths';

const sources = import.meta.glob<string>('../content/docs/**/*.mdx', {
  query: '?raw',
  import: 'default',
  eager: true,
});

const QUIZ_ARRAY = /export const quiz = (\[[\s\S]*?\n\]);/;

function pageFor(id: string): { title: string; href: string } | null {
  const checkpoint = /^checkpoints\/([\w-]+)$/.exec(id)?.[1];
  if (checkpoint) {
    const module = findModule(checkpoint);
    return module
      ? { title: `Checkpoint ${module.number}: ${module.title}`, href: withBase(`/${id}/`) }
      : null;
  }
  const lesson = findLesson(id);
  return lesson ? { title: lesson.title, href: lessonHref(lesson.id) } : null;
}

/** Every lesson quiz and module checkpoint, so the review page can show any due question. */
export const GET: APIRoute = () => {
  const bank: QuestionBank = {};
  for (const [path, source] of Object.entries(sources)) {
    const array = QUIZ_ARRAY.exec(source.replaceAll('\r\n', '\n'))?.[1];
    if (!array) continue;
    const id = path.replace(/^\.\.\/content\/docs\//, '').replace(/\.mdx$/, '');
    const page = pageFor(id);
    if (!page) continue;
    // The arrays are plain literals in this repo's own MDX, which the build already trusts and compiles.
    bank[id] = { ...page, questions: new Function(`return ${array}`)() };
  }
  return new Response(JSON.stringify(bank), { headers: { 'Content-Type': 'application/json' } });
};
