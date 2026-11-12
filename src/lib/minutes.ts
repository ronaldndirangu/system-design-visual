/**
 * Reading time for a lesson, computed from the core path of its MDX source. Prose and on-screen
 * strings (step text, quiz explanations, predict options) count at 200 words per minute, each
 * simulation adds time to play with it, and each Predict, quiz or recall question adds time to answer it.
 */

export const WORDS_PER_MINUTE = 200;
export const MINUTES_PER_SIM = 3;
export const MINUTES_PER_CHECK = 1;
/** Declared minutes in the curriculum may differ from computed minutes by this fraction. */
export const MINUTES_TOLERANCE = 0.25;

export interface LessonStats {
  words: number;
  /** Simulation elements: components imported from `components/widgets/`. */
  sims: number;
  /** Questions in the arrays passed to Quiz and Recall. */
  questions: number;
  predicts: number;
}

const WORD = /[A-Za-z0-9][A-Za-z0-9'’.,%-]*/g;
const OPEN = '([{';
const CLOSE = ')]}';

export function countWords(text: string): number {
  return text.match(WORD)?.length ?? 0;
}

/** Index just past the string literal that starts at `start`, which must be a quote. */
function skipString(src: string, start: number): number {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length && src[i] !== quote) i += src[i] === '\\' ? 2 : 1;
  return i + 1;
}

/** Words inside string literals that read as text: anything with a space in it. */
function stringWords(literal: string): number {
  const inner = literal.slice(1, -1);
  return /\s/.test(inner) ? countWords(inner) : 0;
}

interface Scan {
  end: number;
  words: number;
}

/**
 * Walks code from `start`, skipping strings and tracking bracket depth, until `stop`
 * matches at depth zero. Counts the words in every text-like string on the way.
 */
function scanCode(src: string, start: number, stop: (i: number, depth: number) => boolean): Scan {
  let depth = 0;
  let words = 0;
  let i = start;
  while (i < src.length) {
    const ch = src[i] ?? '';
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = skipString(src, i);
      words += stringWords(src.slice(i, end));
      i = end;
      continue;
    }
    if (OPEN.includes(ch)) depth += 1;
    else if (CLOSE.includes(ch)) depth -= 1;
    if (depth <= 0 && stop(i, depth)) return { end: i + 1, words };
    i += 1;
  }
  return { end: i, words };
}

function stripFrontmatter(src: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(src);
  return match ? src.slice(match[0].length) : src;
}

/** Local names bound to simulation components by `import X from '.../widgets/X'`. */
function simNames(src: string): string[] {
  const names: string[] = [];
  for (const match of src.matchAll(/^import\s+(\w+)\s+from\s+['"][^'"]*\/widgets\/[^'"]*['"]/gm)) {
    if (match[1]) names.push(match[1]);
  }
  return names;
}

function countTags(src: string, name: string): number {
  return src.match(new RegExp(`<${name}\\b`, 'g'))?.length ?? 0;
}

/** The core path: everything outside `<details>` blocks, which hold the optional "Go deeper" material. */
export function corePath(mdx: string): string {
  let core = '';
  let depth = 0;
  let from = 0;
  for (const tag of mdx.matchAll(/<\/?details\b[^>]*>/g)) {
    if (!tag[0].startsWith('</')) {
      if (depth === 0) core += mdx.slice(from, tag.index);
      depth += 1;
    } else if (depth > 0) {
      depth -= 1;
      if (depth === 0) from = tag.index + tag[0].length;
    }
  }
  return depth === 0 ? core + mdx.slice(from) : core;
}

/**
 * Source of each exported array passed as `questions={name}` to a Quiz or Recall, in tag order.
 * Other exports, such as diagram nodes, never count as questions.
 */
export function questionArrays(src: string): string[] {
  const arrays: string[] = [];
  for (const tag of src.matchAll(/<(?:Quiz|Recall)\b[^>]*?\bquestions=\{(\w+)\}/g)) {
    const start = new RegExp(`^export const ${tag[1]} = \\[`, 'm').exec(src);
    if (!start) continue;
    const open = start.index + start[0].length - 1;
    arrays.push(src.slice(open, scanCode(src, open, (_at, depth) => depth === 0).end));
  }
  return arrays;
}

/** Ids of the questions in one array from `questionArrays`. */
export function arrayQuestionIds(array: string): string[] {
  return [...array.matchAll(/[{,]\s*id:\s*(['"])(.*?)\1/g)].map((id) => id[2] ?? '');
}

export function lessonStats(mdx: string): LessonStats {
  const src = stripFrontmatter(mdx);
  let words = 0;
  let prose = '';
  let i = 0;
  while (i < src.length) {
    const atLineStart = i === 0 || src[i - 1] === '\n';
    const rest = src.slice(i, i + 13);
    if (atLineStart && rest.startsWith('import ')) {
      const end = src.indexOf('\n', i);
      i = end === -1 ? src.length : end + 1;
      continue;
    }
    if (atLineStart && rest.startsWith('export ')) {
      const scan = scanCode(src, i, (at) => {
        const ch = src[at];
        if (ch === ';') return true;
        if (ch !== '\n') return false;
        const before = src.slice(i, at).trimEnd();
        return /[\])}'"`\w]$/.test(before) && !/=$/.test(before);
      });
      words += scan.words;
      i = scan.end;
      continue;
    }
    const ch = src[i] ?? '';
    if (ch === '<' && /[A-Za-z/>]/.test(src[i + 1] ?? '')) {
      const scan = scanCode(src, i, (at, depth) => depth === 0 && src[at] === '>');
      words += scan.words;
      prose += ' ';
      i = scan.end;
      continue;
    }
    if (ch === '{') {
      const scan = scanCode(src, i, (_at, depth) => depth === 0);
      words += scan.words;
      prose += ' ';
      i = scan.end;
      continue;
    }
    prose += ch;
    i += 1;
  }
  const sims = simNames(src).reduce((sum, name) => sum + countTags(src, name), 0);
  return {
    words: words + countWords(prose),
    sims,
    questions: questionArrays(src).reduce((sum, array) => sum + arrayQuestionIds(array).length, 0),
    predicts: countTags(src, 'Predict'),
  };
}

export function minutesFor(stats: LessonStats): number {
  const reading = stats.words / WORDS_PER_MINUTE;
  const doing = stats.sims * MINUTES_PER_SIM + (stats.questions + stats.predicts) * MINUTES_PER_CHECK;
  return Math.max(1, Math.round(reading + doing));
}

/** Minutes for a lesson's core path, plus any fixed-clock drill the lesson asks the learner to run. */
export function computeMinutes(mdx: string, drillMinutes = 0): number {
  return minutesFor(lessonStats(corePath(mdx))) + drillMinutes;
}

/** True when a declared estimate sits within the tolerance of the computed one. */
export function minutesAgree(declared: number, computed: number): boolean {
  return Math.abs(declared - computed) <= computed * MINUTES_TOLERANCE;
}
