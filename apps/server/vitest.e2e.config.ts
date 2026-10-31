import { defineConfig } from 'vitest/config';

/**
 * Mocked-HTTP controller suites: the real controller and guards over a stubbed
 * service layer (see test/crm.e2e.test.ts, test/commerce-authorization.e2e.test.ts).
 * They need no database. Real-database suites live under vitest.integration.config.ts.
 */
export default defineConfig({
  test: {
    include: ['test/**/*.e2e.test.ts'],
    globals: true,
    environment: 'node',
  },
});
