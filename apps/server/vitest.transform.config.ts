import swc from 'unplugin-swc';

/**
 * The transform every apps/server vitest config uses (FU-VITEST-DECORATOR-METADATA).
 *
 * WHY. Vitest's default transform is esbuild, which emits no decorator
 * metadata. Nest reads `design:paramtypes` for two things: the constructor's
 * dependencies (DI) and each handler parameter's type, which the global
 * ValidationPipe (app-bootstrap.ts: whitelist + transform) validates against.
 * Under esbuild the pipe got an undefined metatype and passed every body
 * through unchecked and unstripped, so no HTTP suite proved a DTO rule.
 * Production compiles with tsc and emitDecoratorMetadata (tsconfig.json), so
 * production validates. This transform emits the same metadata under vitest.
 * test/dto-validation-harness.spec.ts is the proof.
 *
 * WHAT IT MATCHES. The decorator settings of .swcrc and tsconfig.json:
 * legacy (experimentalDecorators) decorators, decoratorMetadata, class names
 * kept, target es2022 with define semantics for class fields (tsc's default
 * for that target, which is what the production build emits; .swcrc leaves it
 * to swc's default). Three things differ from .swcrc on purpose: modules stay
 * ES (vite runs ES modules; .swcrc says commonjs for a standalone swc build);
 * `loose` is off, since production is tsc, which has no loose mode, and at
 * es2022 there is little left for it to loosen; and .swcrc is not read
 * (swcrc: false), so a change to it cannot silently change the test transform.
 * src/core/config/vitest-transform-coverage.spec.ts checks every config uses
 * this transform.
 *
 * KNOWN DIFFERENCES FROM tsc. swc compiles a file at a time, without type
 * information:
 *  - A parameter typed as an enum, or as an alias of a primitive or of a
 *    literal union (type Mode = 'a' | 'b'), gets Object (or the enum object)
 *    in its metadata where tsc writes String, Number or Boolean. The
 *    ValidationPipe then treats it as Object (not validated, not converted),
 *    where tsc's String/Number would convert a route or query parameter.
 *    Interfaces, object-type aliases and `import type` names are Object in
 *    both.
 *  - An import used only as a parameter's type is kept as a runtime import
 *    (its metadata reads `typeof X === "undefined" ? Object : X`), where tsc
 *    drops it when X is only a type. The metadata is still Object, but the
 *    module is evaluated, which can change load order; under the unit config's
 *    shared registry (isolate:false) that is why some specs reset modules
 *    before their imports (FU-UNIT-MOCK-ISOLATION).
 */
export function serverTransform() {
  return swc.vite({
    swcrc: false,
    configFile: false,
    tsconfigFile: false,
    jsc: {
      // syntax is chosen per file by unplugin-swc (typescript for .ts, ecmascript for .js).
      parser: { decorators: true },
      transform: {
        legacyDecorator: true,
        decoratorMetadata: true,
        useDefineForClassFields: true,
      },
      target: 'es2022',
      keepClassNames: true,
    },
    module: { type: 'es6' },
  });
}
