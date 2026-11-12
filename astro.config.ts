import { readFileSync } from 'node:fs';
import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import { buildSidebar } from './src/data/sidebar';
import { scrollableTables } from './src/lib/scrollableTables';

const repository = 'https://github.com/ronaldndirangu/system-design-visual';
const earlyClickReplay = readFileSync(
  new URL('./src/scripts/early-click-replay.js', import.meta.url),
  'utf8',
);

export default defineConfig({
  site: 'https://ronaldndirangu.github.io',
  base: '/system-design-visual',
  trailingSlash: 'always',
  integrations: [
    starlight({
      title: 'System Design, Visually',
      description:
        'Learn system design by watching systems break and fixing them: interactive, animated lessons from one server to planet scale.',
      logo: { src: './src/assets/logo.svg', alt: 'System Design, Visually' },
      favicon: '/favicon.svg',
      social: [{ icon: 'github', label: 'GitHub repository', href: repository }],
      editLink: { baseUrl: `${repository}/edit/main/` },
      lastUpdated: false,
      customCss: ['./src/styles/fonts.css', './src/styles/theme.css', './src/styles/components.css'],
      expressiveCode: { defaultProps: { wrap: true } },
      head: [
        { tag: 'script', content: earlyClickReplay },
        // Sliders and selects would drift from the widget state if dragged before their island hydrates.
        // Simulations say they are loading until then; clicks in that gap replay after hydration.
        {
          tag: 'style',
          content: [
            'astro-island[ssr] :is(input[type="range"], select) { pointer-events: none; }',
            'astro-island[ssr] .sdv-sim__header::after { content: "Loading interactive..."; color: var(--sl-color-gray-2); font-size: var(--sdv-text-xs); }',
          ].join('\n'),
        },
      ],
      sidebar: buildSidebar(),
      routeMiddleware: './src/routeData.ts',
      components: {
        Head: './src/components/overrides/Head.astro',
        Hero: './src/components/overrides/Hero.astro',
        PageTitle: './src/components/overrides/PageTitle.astro',
        MarkdownContent: './src/components/overrides/MarkdownContent.astro',
      },
    }),
    scrollableTables(),
    react(),
  ],
});
