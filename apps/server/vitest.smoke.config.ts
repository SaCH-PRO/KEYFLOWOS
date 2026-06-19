import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.smoke.test.ts'],
    globals: true,
    environment: 'node',
  },
});
