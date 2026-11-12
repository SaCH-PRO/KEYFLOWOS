/**
 * The completion signal of fire-and-forget writes (W4-FLAKE-HARDEN).
 *
 * Some writers start a database write and return without awaiting it (the
 * ContactAuditEntry write, DEC-CONTACTS-002; the TeamAuditInterceptor team
 * log, written after the response). A suite that counts rows after such a
 * request used to sleep a fixed time first ("settle"), which under load is
 * not long enough: an earlier request's write landed after the baseline was
 * read and was counted against the next, refused, request.
 *
 * trackAsyncWrites() wraps the named methods so every call's promise is
 * recorded while it is in flight; drain() resolves once none is (it also waits
 * for a write started while it waits). The wrapped method's result is returned
 * unchanged, a rejection still reaches the caller, and drain() never rejects.
 * The writers are wrapped on their prototype, so the instance the application
 * holds is covered without reaching into the Nest container.
 *
 * JavaScript on purpose, like sql-like.js: apps/server/tsconfig.json pins
 * rootDir to ./src and includes test/**, so a TypeScript helper here fails the
 * server typecheck with TS6059.
 */

/**
 * @typedef {{ drain(): Promise<void>, inFlight(): number, restore(): void }} AsyncWriteTracker
 */

/**
 * @param {Array<[object, string]>} targets  [prototype, method name] pairs
 * @returns {AsyncWriteTracker}
 */
export function trackAsyncWrites(targets) {
  /** @type {Set<Promise<void>>} */
  const inFlight = new Set();
  /** @type {Array<() => void>} */
  const restores = [];

  for (const [proto, method] of targets) {
    const original = proto[method];
    if (typeof original !== 'function') {
      throw new TypeError(`trackAsyncWrites: ${String(method)} is not a method of the given prototype`);
    }
    proto[method] = function trackedWrite(...args) {
      const result = original.apply(this, args);
      if (result && typeof result.then === 'function') {
        const settled = Promise.resolve(result).then(
          () => undefined,
          () => undefined,
        );
        inFlight.add(settled);
        void settled.then(() => inFlight.delete(settled));
      }
      return result;
    };
    restores.push(() => {
      proto[method] = original;
    });
  }

  return {
    async drain() {
      while (inFlight.size > 0) {
        await Promise.all([...inFlight]);
      }
    },
    inFlight() {
      return inFlight.size;
    },
    restore() {
      for (const undo of restores.splice(0).reverse()) undo();
    },
  };
}
