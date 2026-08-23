# KEYFLOWOS — system map

Two kinds of thing live in this directory, and they do not deserve equal trust.

| | What it is | Trust |
|---|---|---|
| `data/*.csv`, `KEYFLOWOS-system-map.xlsx` | **Generated.** Re-derived from the working tree by `scripts/system-map/`. | Re-runnable. Disagreements with prose are settled here. |
| `0*.md` | **Narrative, written by agents, NOT fully verified.** Partial: 6 of a planned 18. | Treat as leads, not findings. Verify before acting. |

Regenerate the data:

```bash
node scripts/system-map/generate.mjs && node scripts/system-map/build-xlsx.mjs
```

## Read the caveats before using a number

The workbook's README sheet carries them in full. The two that matter most:

**Do not delete code on the strength of `orphan` / `fan_in` alone.** It counts
static relative imports, so it is wrong in *both* directions — it under-reports
(dynamic `import()`, barrel re-exports, Next.js file-convention entry points
like `page.tsx` which the framework enters and nothing imports) and a name grep
does not fix it, because it over-reports (grepping `ActivityItem` returns 27
hits in this repo, every one a different module).

**`unguarded=TRUE` means no guard *decorator* was found**, not that a route is
publicly reachable. [public-surface.spec.ts](../../apps/server/src/core/auth/public-surface.spec.ts)
measures closer to the real property and **ratchets** — it fails the build when
the count moves the wrong way. Where the two disagree, believe the ledger.

## Why the caveats are stated so bluntly

Every headline number this tool produced was wrong at least once, always the
same way: **it measured an easy-to-grep proxy instead of the property being
claimed.** Corrected, with the reason:

| Claimed | Actually measured | Was → Is |
|---|---|---|
| unguarded routes | decorators written *after* the HTTP decorator only — missed `@UseGuards(X) @Patch(…)` and class-level guards above `@Controller` | 609 → 55 |
| web calls with no server route | seven false-positive classes — the worst was an origin heuristic matching `basePath`, which reduced whole screens to a path tail | 166 → 13 |
| `apiGet` call sites | `apiGet<` — the generic form only | 26 → 94 |
| listeners with no emitter | `emit('x')` — missed the `emitEvent(bizId, 'x', …)` wrapper | 30 → 16 |

A comment stripper that ate `if (/^https?:\/\//.test(url)) {` — the regex ends
in `//` — also swallowed 26 routes from one controller before it was fixed.

Route extraction now matches ground truth exactly: **2,189 decorators found,
2,189 extracted, zero misses.** That equality is the check worth re-running; a
gap means the scanner has drifted again.

## Sheets

| Sheet | Grain | Look for |
|---|---|---|
| `modules` | server module | `mounted=FALSE` with routes — unreachable code |
| `routes` | HTTP route | `unguarded=TRUE` on a mounted route |
| `web-api-calls` | fetch from the web app | `NO_SERVER_ROUTE` — client calls a path the server won't serve |
| `events` | event name | `LISTENED_NEVER_EMITTED` — a handler that can never run |
| `models` | Prisma model | `has_businessId=FALSE` — outside the tenant boundary |
| `files` | source file | size, fan-in (read the warning above first) |
| `edges` | one relationship | the dependency graph — imports, injects, emits, listens, model reads/writes, http calls |

`edges` is the relations table; it pivots into any view you want.

## Open findings

- Eight of ten handlers in `key-cortex-realtime.service.ts` subscribe to events
  nothing emits, so most of the websocket forwarding layer is unreachable. The
  dot/colon split (`key.alert` vs `key:alert`) is NOT the bug — that is the
  correct two-layer design, internal bus forwarding to a socket channel. The bug
  is that the bus event is never raised. `apps/server/src/core/event-bus/`
  `event-wiring.spec.ts` is the ratchet for this, and its analyser is stricter
  than mine was.
- 13 web calls hit no server route (3 are test fixtures); 16 more are UNVERIFIED —
  the shape exists but an unresolved interpolation means it cannot be proven either way.
- `gamification` is on disk with routes but is not in the module graph. That one
  is deliberate — it is marked `@keyflow:dormant`.

## The lesson worth keeping

A reporter tells you a number. A **ratchet** fails the build when the number
moves the wrong way, and cannot be quietly ignored. This dataset is a reporter;
`public-surface.spec.ts` is a ratchet. The findings here are most useful once
converted into the second kind.
