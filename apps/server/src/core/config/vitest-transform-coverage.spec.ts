/**
 * Every apps/server vitest config uses the decorator-metadata transform
 * (FU-VITEST-DECORATOR-METADATA).
 *
 * test/dto-validation-harness.spec.ts proves the transform at runtime under
 * vitest.config.ts and vitest.e2e.config.ts, and the runtime case below proves
 * it under vitest.unit.config.ts. Nothing would notice the plugin being dropped
 * from vitest.integration.config.ts or vitest.smoke.config.ts: their HTTP
 * suites would just stop validating, as all of them did under esbuild. This
 * pins the wiring of every config file statically.
 */
import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const SERVER_ROOT = join(__dirname, '..', '..', '..');
const TRANSFORM = 'vitest.transform.config.ts';

const configs = readdirSync(SERVER_ROOT).filter((f) => /^vitest.*\.config\.ts$/.test(f) && f !== TRANSFORM);

describe('every apps/server vitest config uses serverTransform (FU-VITEST-DECORATOR-METADATA)', () => {
  it('finds the configs: this check is not vacuous', () => {
    expect(configs).toEqual(
      expect.arrayContaining([
        'vitest.config.ts',
        'vitest.unit.config.ts',
        'vitest.integration.config.ts',
        'vitest.e2e.config.ts',
        'vitest.smoke.config.ts',
      ]),
    );
  });

  it.each(configs)('%s imports serverTransform and installs it as a plugin', (file) => {
    const src = readFileSync(join(SERVER_ROOT, file), 'utf8');
    expect(src).toMatch(/import \{ serverTransform \} from '\.\/vitest\.transform\.config';/);
    expect(src).toMatch(/plugins:\s*\[\s*serverTransform\(\)\s*\]/);
  });

  it('the transform emits legacy decorators with metadata and does not read .swcrc', () => {
    const src = readFileSync(join(SERVER_ROOT, TRANSFORM), 'utf8');
    expect(src).toMatch(/legacyDecorator:\s*true/);
    expect(src).toMatch(/decoratorMetadata:\s*true/);
    expect(src).toMatch(/swcrc:\s*false/);
  });

  it('this file runs with design:paramtypes emitted (the config running it uses the transform)', () => {
    const noop: MethodDecorator = () => undefined;
    class Probe {
      constructor(readonly a: Date) {}
      @noop
      m(_x: Date, _y: string) {}
    }
    expect(Reflect.getMetadata('design:paramtypes', Probe.prototype, 'm')).toEqual([Date, String]);
    expect(Reflect.getMetadata('design:paramtypes', Probe)).toBeUndefined(); // undecorated class: none, as tsc
  });
});
