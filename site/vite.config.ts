import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  base: '/one-tool/',
  resolve: {
    alias: {
      '@onetool/one-tool/browser': path.resolve(__dirname, '../src/browser.ts'),
    },
  },
});
