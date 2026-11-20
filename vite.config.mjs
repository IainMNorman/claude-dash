import { defineConfig } from 'vite';

const target = `http://127.0.0.1:${process.env.CLAUDE_DASH_PORT || 47821}`;

export default defineConfig({
  root: 'src/renderer',
  base: './',
  build: { outDir: '../../dist/renderer', emptyOutDir: true },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': target, '/event': target },
  },
});
