import { defineConfig } from 'vitest/config';
import { serverTransform } from './vitest.transform.config';

/**
 * Mocked-HTTP controller suites: the real controller and guards over a stubbed
 * service layer (see test/crm.e2e.test.ts, test/commerce-authorization.e2e.test.ts).
 * They need no database. Real-database suites live under vitest.integration.config.ts.
 * test/dto-validation-harness.spec.ts is the same shape (a real controller over
 * a stub service, no database) and proves this config's transform.
 */
export default defineConfig({
  // Emits decorator metadata as tsc does, so the ValidationPipe validates. See vitest.transform.config.ts.
  plugins: [serverTransform()],
  test: {
    include: ['test/**/*.e2e.test.ts', 'test/dto-validation-harness.spec.ts'],
    globals: true,
    environment: 'node',
  },
});
