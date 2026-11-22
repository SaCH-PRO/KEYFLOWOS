# KEYFLOWOS session checkpoint, 21 Nov 2026

This checkpoint continues `docs/reconstruction/V1-HANDOFF-2026-11-20.md`; that file and `V1-PLAN-RECUT.json` stay the plan of record. It records what one Claude Code cloud session found and did, so the next session can resume from the repository alone.

**Authority:** OWNER-DIR-V1-STANDING-001 (#80 comment 7051296684, ruling D-222). This session's ACK is CC-ACK-V1-SESSION-20261121-001 (#80 comment 7070722674).

## 1. State found at session start

- **main:** `8c11a847` (wave 2b, #214). It is green on CI `Run Tests`.
- **Open wave PRs:** #215 (wave 3a part 1, 6 packets) and #216 (part 2, FU-PHONE-COUNTRY-DUPLICATES). Both are red on CI `Run Tests`, though their PR bodies report every suite green.
  - **#215** (`6df334c5`): BA-04 in `apps/server/src/modules/commerce/balance-arithmetic.spec.ts` failed.
    - The cause is W11-CORTEX-INSIGHT-QUERIES. It moved the report forecast in `key-cortex-insight.service.ts` from `status: 'completed'`, which matches no row, to `status: 'SUCCESSFUL'`. A SUCCESSFUL-only sum counts refunded money as received (D-14).
    - The web suite never ran on that head, because the server suite failed first.
  - **#216** (`6a6ec628`): the server suite passed 759/759. One web test failed on load timing: `invoices-whatsapp-confirm-escape.test.tsx` took 1658 ms against the 1000 ms default of `waitFor`.
    - #216 changes no web file, and main is green on that test.
    - It passed 3 of 3 runs locally.
    - It belongs to W11-LOAD-SENSITIVE-TESTS (step 7). Only the failed job was re-run.
- **Dependabot PRs** #203 to #213 are open. They are not v1 packets; S0-DEPENDABOT-FREEZE (step 0) governs them.
- **Cloud environment:** the session's Default environment had no setup script and no `node_modules`. Postgres and Redis were not running. The Node version was 22.23.5, but `.nvmrc` pins 22.23.4, so `scripts/ci/runtime-pin.spec.mjs` failed one case.

## 2. What this session did

| Work | Branch | State |
|---|---|---|
| W11-CORTEX-INSIGHT-QUERIES repair (BA-04) | pushed to `wave/v1-wave-3a` (#215) | RED `1d6c1822`, fix `d4fd4118`. Full server and web suites green, R0 MET (see §3). |
| W11-CORTEX-SESSION-SNAPSHOT-SCOPE (KC-SEC-3, step 3, P0) | `pkt/V1-W11-CORTEX-SESSION-SNAPSHOT-SCOPE` (pushed), stacked on the repair | RED `1c8ce693`, fix `f550c3e9`, review repair `99238115`/`17639719` (pendingInvoices). 199/199 passing, tsc 0. Full server suite at `17639719`: 761/761 files, 13936 passed. |
| FU-KEY-CHAT-GENOME-MONEY-SIGHT (proposed V1-71 follow-up; security finding 1 of the packet above) | `pkt/V1-FU-KEY-CHAT-GENOME-MONEY-SIGHT` (pushed), stacked on the snapshot packet | RED `cc52c55b` (8 leaks), fix `03bc8ec5`. Both reviews found the same blocking defect: a finance signal filed under another module, e.g. `key_autonomy` with `section: FINANCE`. Its RED is `00999965` (5 cases) and its repair `6b43ea4d`, which carries `section` and `domain`, moves the cache key to v2 and picks suggestions from the reader's genome. 464/464 passing, tsc 0. Full suite pending. |
| FU-WA-ESCAPE-RACE (new follow-up of COR-WACP-1; the #216 CI failure) | pushed to `wave/v1-wave-3a-phone` (#216) | RED `51605d36` (deterministic), fix `048e5fcf` (`useLayoutEffect`), `3a73999f`, `63119d06`. Reviewed: no blocking or major findings. |
| Local test environment | `scripts/dev/claude-cloud-env.sh` (on the session branch) | `up` and `verify`. `verify` passes, with a negative control. |
| Cloud environment `keyflowos` (personal) | Claude environment settings | The setup script is saved; this session runs on it. It is unproven until a fresh session starts. |

## 3. Proof

| Check | Result |
|---|---|
| Repair RED, at `1d6c1822` | 2 failed / 94 passed: the new forecast case expected 550 and got 650; the BA-04 inventory |
| Repair GREEN (key-cortex, cast-integrity and BA specs, the read-scope suite) | 119 files, 1749 passed |
| Full server suite (`pnpm test:ci`), at `d4fd4118` | 761/761 files, 13925 passed, 0 failed |
| Server `tsc --noEmit` | exit 0 |
| Snapshot packet RED, at `1c8ce693` | 4 failed / 76 passed: STAFF with revenue none and ADMIN with an empty map get `totalRevenue: 4321` on POST sessions and on POST chat `contextUsed` |
| Snapshot packet GREEN, at `f550c3e9` | 80/80 |

| #215 web suite, at `d4fd4118` | 166/166 files, 1476 passed |
| #215 server lint | 0 errors / 3155 warnings (≤ 3343) |
| #215 `proof:release0` | 39/39 SATISFIED, R0 EXIT GATE MET |
| #216 web suite, at `3a73999f` | 163/163 files, 1445 passed; web tsc 0; web lint 0 errors / 25 warnings |

The RETURN is CC-RETURN-V1-SESSION-20261121-001 (#80 comment 7071174439).

## 4. Lessons for the next session

- Run per-packet regressions in sequence, never beside a full-suite run on the same database. Suites with fixed fixture ids collide.
  - For parallel packet worktrees, use `scripts/worktree-resources.sh provision <packet-id>`, which gives each packet its own database and Redis index.
  - A worktree also needs its own `apps/server/dist` (run `pnpm --filter server build`) for suites that spawn the server.
- Vitest's esbuild emits no decorator metadata. In a hand-built Nest testing module, build services with a `useFactory` (as the suites do), or their constructor dependencies are undefined.
- Before trusting a PR body, check the PR head's CI check runs.
- Web `next typegen` needs `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001` locally, as CI sets it. Without it, typegen fails silently and tsc reports a missing `next` type library.
- In Redis 7, `CONFIG SET dir` is protected. Start redis-server with `--dir` outside the repository (the bootstrap does), so `dump.rdb` never lands in the tree.

## 5. How to resume (phone or terminal)

1. Open a Claude Code cloud session on this repository and say: "resume KEYFLOWOS from the latest checkpoint".
2. The session runs `bash scripts/dev/claude-cloud-env.sh up`, then `export PATH=/opt/node-$(cat .nvmrc)/bin:$PATH`.
3. Read #80 from the newest message back to the last owner or ChatGPT message, then the RETURNs.
4. Continue at §6.

## 6. Next executable work, in order

1. **Owner:** merge #215, then #216 when CI is green (Claude does not merge).
2. **W11-CORTEX-SESSION-SNAPSHOT-SCOPE:** run the full server suite and proof:release0 on its head, then join a wave 3b PR once #215 is on main.
3. **FU-KEY-CHAT-GENOME-MONEY-SIGHT:** built and reviewed (see §2).
   - Left to do: its full server suite, then proof:release0 on its head.
   - It joins wave 3b with the snapshot packet.
4. **FU-KEY-GENOME-READS-RESIDUAL** (proposed): the genome reads that still have no viewer, which the reviews of item 3 recorded:
   - `key-cortex-interaction.service.ts` explainDecision;
   - the legacy `reasoning.service` getProactiveSuggestions and its own `genome:context:` cache;
   - consciousness getActiveGoals;
   - creativity getGenomeContext.
   - **Owner questions:** is a finance DNA score a finance signal under D-128? Do SALES rows count as money?
5. **Next eligible packets** (`deps_met` per `V1-STATUS-2026-11-20.json`, counting wave 2b and 3a as done):
   - step 3: BIZ-SETTINGS-WEB (P0, web), FU-MERGE-CONTACTS-UNIQUE, FU-CONTACT-AUDIT-RESIDUAL (D-207), SWP-COA-UNIQUE-CODE, FU-UNIT-GUARD-CI, FU-OVERLAY-LAYER-TABLE, FU-COMMUNITY-LIKE-OWN-ACTION;
   - step 4: SWP-INV-MONEY-TOTALS (P0), SWP-BOOKING-PAYMENT-GATE, W11-GENOME-RECS-DOMAIN, SWP-CENSUS-KEY-B, SWP-CENSUS-GENOME, W1F-ORDER-TRANSITIONS, W1F-STORE-STRIPE-R0.
6. **Gate packets with no dependencies:** S0-SEC-LANE-DEPLOY (P0), S0-DEPENDABOT-FREEZE, TOF-STALE-GATES-PKT, SWEEP-RERUN-S2.

## 7. Operator console (mobile)

Not started. The plan of record holds no operator-console packet, so building one needs an owner ruling that adds it to `V1-PLAN-RECUT.json`.

What exists to reuse:
- **The web app is already an installable PWA:** `apps/web/src/app/manifest.ts`, `public/sw.js` and `/offline`.
- **A platform admin area:** `apps/web/src/app/admin/`, with `ai-usage`, `system`, `analytics`, `events` and `feature-flags`, behind its own `login` and layout. That is the natural home for an owner-only console page; a new app is not needed.

The proposed first increment:
- read-only;
- owner-only;
- shows repository and CI state with timestamps.

Questions for the owner:
- where it lives;
- how it authenticates;
- whether its GitHub read runs server-side only.

## 8. Waiting on the owner

These are carried from the 20 Nov handoff §6, still open:
- credential rotation;
- the GitGuardian false positives;
- the tie-off branches;
- the step 8 launch-gate plan.

Production stays on hold (D-172).
