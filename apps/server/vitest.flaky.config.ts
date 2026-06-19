import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.flaky.test.ts'],
    globals: true,
    environment: 'node',
  },
});
