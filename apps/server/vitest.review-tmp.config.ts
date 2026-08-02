import { defineConfig } from 'vitest/config';

export default defineConfig({
  css: { postcss: {} },
  test: {
    globals: true,
    environment: 'node',
  },
});
