import { defineConfig } from 'vitest/config';

// packages/* carried ZERO tests for the repo's entire life — which is how the
// tRPC social.listConnections token disclosure survived: the only workspace
// layer no gate could see. This config exists so that is never true again.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
