import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));
const HEX = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/gi;
// theme.css defines the tokens, and the theme-color meta tag cannot read CSS variables.
const ALLOWED = new Set(['src/styles/theme.css', 'src/components/overrides/Head.astro']);

function sources(dir: string): string[] {
  return readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.(ts|tsx|css|astro)$/.test(file))
    .map((file) => relative(root, join(root, dir, file)).replaceAll('\\', '/'))
    .filter((file) => !ALLOWED.has(file));
}

describe('color tokens', () => {
  it('keeps raw hex colors out of components, physics scenes and styles', () => {
    const files = [...sources('src/components'), ...sources('src/styles')];
    expect(files.some((file) => file.startsWith('src/components/physics/'))).toBe(true);
    const offenders = files.flatMap((file) =>
      readFileSync(join(root, file), 'utf8')
        .split('\n')
        .flatMap((line, index) => (line.match(HEX) ?? []).map((hex) => `${file}:${index + 1} ${hex}`)),
    );
    expect(offenders).toEqual([]);
  });
});
