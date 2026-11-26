import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
// Each game builds into its own folder of dist/, served at /<repo>/<game>/ on Pages.
export default defineConfig({
  base: './',
  resolve: { alias: { '@engine': fileURLToPath(new URL('../../engine/src', import.meta.url)) } },
  build: { outDir: '../../dist/shooter', emptyOutDir: true },
});
