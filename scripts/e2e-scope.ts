import { execFileSync } from 'node:child_process';
import { appendFileSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type E2eScope = { mode: 'full'; reason: string } | { mode: 'pr'; pages: string[]; specs: string[] };

const SRC_DIR = 'src/';
const DOCS_DIR = 'src/content/docs/';
const SPEC_DIR = 'tests/e2e/';
const ALWAYS_SPECS = ['tests/e2e/hydration.spec.ts', 'tests/e2e/site.spec.ts'];
// Changes here reach pages only through the files that import them, so the walk continues upward.
const PASS_THROUGH_DIRS = ['src/lib/models/', 'src/components/widgets/', 'src/components/physics/'];
// Every lesson PR edits the curriculum, and site.spec always checks the landing and curriculum pages.
const SAMPLED_FILES = new Set(['src/data/curriculum.ts']);
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.astro', '.mdx', '.md', '.css', '.js'];
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"]+)['"]/g;

function full(reason: string): E2eScope {
  return { mode: 'full', reason };
}

function resolveSpecifier(importer: string, specifier: string, sources: Record<string, string>) {
  if (!specifier.startsWith('.')) return undefined;
  const base = path.posix.join(path.posix.dirname(importer), specifier.split('?')[0] ?? specifier);
  const candidates = [base, ...SOURCE_EXTENSIONS.map((ext) => base + ext), `${base}/index.ts`];
  return candidates.find((candidate) => candidate in sources);
}

function importersOf(sources: Record<string, string>): Map<string, Set<string>> {
  const importers = new Map<string, Set<string>>();
  for (const [file, text] of Object.entries(sources)) {
    for (const match of text.matchAll(SPECIFIER)) {
      const target = resolveSpecifier(file, match[1] ?? '', sources);
      if (!target || target === file) continue;
      const set = importers.get(target) ?? new Set<string>();
      set.add(file);
      importers.set(target, set);
    }
  }
  return importers;
}

function pageForDoc(file: string): string {
  const route = file.slice(DOCS_DIR.length).replace(/\.mdx?$/, '');
  if (route === 'index') return './';
  return `${route.replace(/\/index$/, '')}/`;
}

/** Decide which pages and specs a pull request needs, or fall back to the full suite. */
export function scopeFromChanges(
  changedFiles: readonly string[],
  sources: Record<string, string>,
  specs: Record<string, string>,
): E2eScope {
  const importers = importersOf(sources);
  const pages = new Set<string>();
  const selectedSpecs = new Set(ALWAYS_SPECS);

  for (const file of changedFiles) {
    if (file.startsWith('tests/unit/')) continue;
    if (!file.includes('/') && file.endsWith('.md')) continue;
    if (file.startsWith(SPEC_DIR)) {
      if (ALWAYS_SPECS.includes(file) || !(file in specs)) return full(`${file} changed`);
      selectedSpecs.add(file);
      continue;
    }
    if (!file.startsWith(SRC_DIR) || !(file in sources)) return full(`${file} changed`);
    if (SAMPLED_FILES.has(file)) continue;

    const queue = [file];
    const visited = new Set(queue);
    for (const current of queue) {
      if (current.startsWith(DOCS_DIR)) {
        const page = pageForDoc(current);
        if (page === '404/') return full(`${file} reaches the 404 page`);
        pages.add(page);
      } else if (PASS_THROUGH_DIRS.some((dir) => current.startsWith(dir))) {
        for (const importer of importers.get(current) ?? []) {
          if (visited.has(importer)) continue;
          visited.add(importer);
          queue.push(importer);
        }
      } else {
        return full(`${file} reaches shared code in ${current}`);
      }
    }
  }

  for (const page of pages) {
    const segment = page.split('/')[0];
    if (!segment || page === './') continue;
    for (const [spec, text] of Object.entries(specs)) {
      if (text.includes(`${segment}/`)) selectedSpecs.add(spec);
    }
  }

  return { mode: 'pr', pages: [...pages].sort(), specs: [...selectedSpecs].sort() };
}

function readTree(dir: string, keep: (file: string) => boolean): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    const file = path.posix.join(dir, entry.replaceAll('\\', '/'));
    if (keep(file)) files[file] = readFileSync(file, 'utf8');
  }
  return files;
}

function changedFilesAgainst(baseRef: string): string[] | undefined {
  try {
    const output = execFileSync('git', ['diff', '--name-only', `origin/${baseRef}...HEAD`], {
      encoding: 'utf8',
    });
    return output.split('\n').filter(Boolean);
  } catch {
    return undefined;
  }
}

function main() {
  const baseRef = process.env.BASE_REF || 'main';
  const changed = changedFilesAgainst(baseRef);
  const scope = changed
    ? scopeFromChanges(
        changed,
        readTree('src', (file) => SOURCE_EXTENSIONS.includes(path.posix.extname(file))),
        readTree('tests/e2e', (file) => file.endsWith('.spec.ts')),
      )
    : full(`could not diff against origin/${baseRef}`);

  const lines =
    scope.mode === 'full'
      ? ['mode=full', 'pages=', 'specs=']
      : ['mode=pr', `pages=${scope.pages.join(',')}`, `specs=${scope.specs.join(' ')}`];
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  process.stdout.write(`${scope.mode === 'full' ? `Full suite: ${scope.reason}` : lines.join('\n')}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
