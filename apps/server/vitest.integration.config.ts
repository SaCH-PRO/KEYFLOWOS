import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.integration.test.ts'],
    passWithNoTests: true,
    globals: true,
    environment: 'node',
  },
});
