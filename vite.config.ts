import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// "single" mode bundles everything into one HTML file (used for quick previews).
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: mode === 'single' ? [viteSingleFile()] : [],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist', chunkSizeWarningLimit: 1000 },
}));
