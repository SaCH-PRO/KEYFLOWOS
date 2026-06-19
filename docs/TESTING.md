# KEYFlowOS Testing Guide

This document defines how tests are organized, how to run them, and how to categorize new tests.

---

## Test categories

Tests in `apps/server` are split into four categories:

| Category | Pattern | Purpose | Run command |
|----------|---------|---------|-------------|
| Unit / controller / service | `src/**/*.spec.ts` | Fast, deterministic tests with mocked dependencies. | `pnpm test:unit` |

Suite config files live in `apps/server/`:

| Suite | Config |
|-------|--------|
| Unit | `vitest.unit.config.ts` |
| Smoke | `vitest.smoke.config.ts` |
| Integration | `vitest.integration.config.ts` |
| Flaky | `vitest.flaky.config.ts` |

`pnpm test:unit` scans only the `src/` directory, so no `test/` files run.
| Smoke | `test/*.smoke.test.ts` | Fast end-to-end sanity checks that the operating system routes/modules boot and return expected shapes. | `pnpm test:smoke` |
| Integration / e2e | `test/*.integration.test.ts` | Tests that exercise multiple modules, the database, or external connectors. Slower and may require environment setup. | `pnpm test:integration` |
| Flaky / quarantined | `test/*.flaky.test.ts` | Tests with known intermittent failures (timeouts, platform-specific process issues, live connectors). Run separately and do not block CI. | `pnpm test:flaky` |

> Frontend tests currently rely on `pnpm --filter web build` for static type/build correctness. Add component/route tests only if a test framework is already configured.

---

## Running tests

### Reliable CI signal

```bash
# Run unit + smoke tests (fast, deterministic)
pnpm test:ci
```

### Individual suites

```bash
# Unit/service/controller tests only
pnpm test:unit

# Smoke tests only
pnpm test:smoke

# Integration/e2e tests only
pnpm test:integration

# Known flaky tests only
pnpm test:flaky

# Everything (includes flaky tests; useful for local investigation)
pnpm test
```

### Targeted test files

```bash
# Single file
pnpm test src/modules/business-command-center/business-command-center.service.spec.ts

# Directory
pnpm test src/modules/key-inbox/
```

---

## Adding a new test

1. Decide the category first.
2. Use the appropriate file suffix.
3. Keep unit tests deterministic and free of live network/DB calls when possible.
4. If a test is flaky, do not leave it in the main suite. Either fix the root cause or quarantine it with a `TODO` comment explaining the issue and linking to a tracking item.

---

## Known flaky tests

The following tests are quarantined in the flaky suite:

| File | Reason | Next action |
|------|--------|-------------|
| `test/calendar-module.flaky.test.ts` | Timeout / ECONNRESET when exercising Google Calendar connector paths. | Mock connector boundaries and move to integration suite, or freeze time and use deterministic fixtures. |
| `test/calendar.controller.flaky.test.ts` | Timeout / ECONNRESET in calendar controller integration setup. | Reduce module bootstrap scope; mock Prisma/Redis where appropriate. |
| `test/keyflow-dev-auth.flaky.test.ts` | Full app boot via `tsx` times out on Windows before guard exits the process. | Split into fast guard-logic unit test + one slower integration boot test. |

Do not add new tests to the flaky suite without a clear remediation plan.

---

## Conventions

- Use `vi.fn()` from Vitest for mocks.
- Prefer factory helpers (`makeController`, `makeService`) over heavy `Test.createTestingModule` for unit tests.
- Use deterministic fixtures for dates, IDs, and business IDs.
- Do not assert on exact object identity when order or extra metadata may vary.
- Keep controller tests focused on request/response mapping and guard behavior, not business logic.

---

## CI expectations

- `pnpm test:ci` must pass before merging.
- `pnpm test:flaky` failures must be investigated but do not block merges.
- `pnpm test:integration` failures block merges unless the failure is documented and tracked.
