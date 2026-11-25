import { defineConfig } from 'vitest/config';
import { serverTransform } from './vitest.transform.config';

export default defineConfig({
  // Emits decorator metadata as tsc does, so the ValidationPipe validates. See vitest.transform.config.ts.
  plugins: [serverTransform()],
  test: {
    include: ['test/**/*.integration.test.ts'],
    globals: true,
    environment: 'node',
  },
});
