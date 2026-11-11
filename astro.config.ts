import { readFileSync } from 'node:fs';
import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import { buildSidebar } from './src/data/sidebar';

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
      customCss: ['./src/styles/theme.css', './src/styles/components.css'],
      head: [
        { tag: 'script', content: earlyClickReplay },
        // Sliders and selects would drift from the widget state if dragged before their island hydrates.
        {
          tag: 'style',
          content: 'astro-island[ssr] :is(input[type="range"], select) { pointer-events: none; }',
        },
      ],
      sidebar: buildSidebar(),
      routeMiddleware: './src/routeData.ts',
      components: {
        Hero: './src/components/overrides/Hero.astro',
        PageTitle: './src/components/overrides/PageTitle.astro',
        MarkdownContent: './src/components/overrides/MarkdownContent.astro',
      },
    }),
    react(),
  ],
});
