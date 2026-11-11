// Checks every color pair from plan section 4.2 against the tokens in src/styles/theme.css.
// Run `node scripts/contrast.mjs`; it exits 1 when a pair falls below its minimum.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** @typedef {{ fg: string, bg: string, min: number }} Pair */
/** @typedef {Record<string, string>} Tokens */

const LITERAL = /^#[0-9a-f]{6}$/i;

/** @param {string} hex */
function luminance(hex) {
  const channels = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/**
 * WCAG 2.2 contrast ratio between two #rrggbb colors.
 * @param {string} a
 * @param {string} b
 */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

/**
 * @param {string} css
 * @param {string} selector
 */
function block(css, selector) {
  const start = css.indexOf(`\n${selector} {`);
  if (start < 0) throw new Error(`theme.css has no top-level ${selector} block`);
  const end = css.indexOf('\n}', start);
  return css.slice(start, end);
}

/** @param {string} body */
function literals(body) {
  /** @type {Tokens} */
  const tokens = {};
  for (const [, name, value] of body.matchAll(/--sdv-([\w-]+):\s*([^;]+);/g)) {
    if (name && value && LITERAL.test(value.trim())) tokens[name] = value.trim().toLowerCase();
  }
  return tokens;
}

/**
 * Literal --sdv- colors per theme. The light theme inherits any dark token it does not override.
 * @param {string} css
 * @returns {{ dark: Tokens, light: Tokens }}
 */
export function parseTokens(css) {
  const dark = literals(block(css, ':root'));
  const light = { ...dark, ...literals(block(css, ':root[data-theme="light"]')) };
  return { dark, light };
}

const TEXT = 4.5;
const NON_TEXT = 3;

/** @type {Pair[]} */
export const PAIRS = [
  ...['text-1', 'text-2', 'text-3', 'accent-text', 'ok', 'warn', 'bad'].flatMap((fg) =>
    ['bg', 'bg-subtle', 'surface-1', 'surface-2', 'sunken'].map((bg) => ({ fg, bg, min: TEXT })),
  ),
  ...['text-1', 'text-2', 'text-3'].map((fg) => ({ fg, bg: 'surface-3', min: TEXT })),
  { fg: 'accent-text', bg: 'accent-subtle', min: TEXT },
  { fg: 'ok', bg: 'ok-soft', min: TEXT },
  { fg: 'warn', bg: 'warn-soft', min: TEXT },
  { fg: 'bad', bg: 'bad-soft', min: TEXT },
  { fg: '#ffffff', bg: 'accent', min: TEXT },
  { fg: '#ffffff', bg: 'accent-hover', min: TEXT },
  ...['surface-1', 'surface-2', 'sunken'].map((bg) => ({ fg: 'border-control', bg, min: NON_TEXT })),
];

/**
 * @param {Tokens} tokens
 * @param {string} ref
 */
function resolve(tokens, ref) {
  const value = LITERAL.test(ref) ? ref : tokens[ref];
  if (!value) throw new Error(`theme.css does not define --sdv-${ref} as a #rrggbb literal`);
  return value;
}

/**
 * @param {string} css
 * @returns {{ theme: 'dark' | 'light', fg: string, bg: string, min: number, ratio: number }[]}
 */
export function checkPairs(css) {
  const themes = parseTokens(css);
  return /** @type {const} */ (['dark', 'light']).flatMap((theme) =>
    PAIRS.map(({ fg, bg, min }) => ({
      theme,
      fg,
      bg,
      min,
      ratio: contrast(resolve(themes[theme], fg), resolve(themes[theme], bg)),
    })),
  );
}

export const themePath = fileURLToPath(new URL('../src/styles/theme.css', import.meta.url));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const results = checkPairs(readFileSync(themePath, 'utf8'));
  const failures = results.filter((r) => r.ratio < r.min);
  for (const r of results) {
    const mark = r.ratio < r.min ? 'FAIL' : 'ok  ';
    process.stdout.write(
      `${mark} ${r.theme.padEnd(5)} ${r.fg} on ${r.bg}: ${r.ratio.toFixed(2)} (min ${r.min})\n`,
    );
  }
  process.stdout.write(`${results.length - failures.length}/${results.length} pairs pass\n`);
  if (failures.length > 0) process.exitCode = 1;
}
