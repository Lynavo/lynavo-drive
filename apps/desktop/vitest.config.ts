import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/renderer/__tests__/setup.ts'],
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer'),
    },
  },
});
