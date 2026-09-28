// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

// The public site address. Set PUBLIC_SITE_URL in Cloudflare Pages
// (e.g. https://travelinhimachal.in) so canonical URLs and the sitemap use it.
const site = process.env.PUBLIC_SITE_URL ?? 'http://localhost:4321';

export default defineConfig({
  site,
  // Fully static output: Cloudflare Pages serves plain files, so no
  // Pages Functions (and no Workers request quota) are ever used.
  output: 'static',
  trailingSlash: 'never',
  build: { format: 'file' },
  integrations: [
    react(),
    sitemap({
      // Private areas never go into the sitemap.
      filter: (page) => !page.includes('/admin') && !page.includes('/track'),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
