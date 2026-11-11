import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import { buildSidebar } from './src/data/sidebar';

const repository = 'https://github.com/ronaldndirangu/system-design-visual';

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
