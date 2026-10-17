import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.dirname(fileURLToPath(import.meta.url));
if (!/^(original_spec|baseline|candidate|mutant)$/.test(process.env.FLOW_PROOF_VARIANT || '')) {
  throw new Error('FLOW_PROOF_VARIANT must name an isolated proof variant');
}
export default {
  root: path.join(root, 'vitest-work', process.env.FLOW_PROOF_VARIANT),
  resolve: { alias: {
    '@nestjs/event-emitter': path.join(root, 'vitest-work', 'event-emitter.stub.ts'),
  } },
  test: {
    environment: 'node', globals: false, watch: false,
    include: ['apps/server/src/modules/ai/ai-oversight-fails-closed.spec.ts'],
    pool: 'threads', poolOptions: { threads: { singleThread: true } },
    setupFiles: [path.join(root, 'vitest-work', 'forbid-network.mjs')],
  },
};
