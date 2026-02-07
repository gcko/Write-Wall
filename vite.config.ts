import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'es2024',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'src/main.ts'),
        service_worker: resolve(__dirname, 'src/service_worker.ts'),
      },
      output: {
        entryFileNames: '[name].bundle.js',
      },
    },
  },
});
