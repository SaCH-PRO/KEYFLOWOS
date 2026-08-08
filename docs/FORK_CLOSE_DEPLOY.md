# Deploying `merge/fork-close` to production

Written 2026-08-08, after closing the 2026-07-08 fork. Everything here that could
be verified without touching the server has been. What remains needs the box.

**Read §1 before anything else. It is the step that can lose data.**

---

## What production is, and what it is about to receive

| | |
|---|---|
| Host | Hetzner VPS `37.27.27.0`, `/opt/keyflowos`, Docker Compose behind Caddy |
| Running | `origin/hotfix/tenant-security-2026-08` (integration's lineage) |
| Migration history ends at | `20260722224337_contract_clause_analysis` |
| Tables | 443 |
| Deploying | `merge/fork-close` — main + integration, fully merged |

Six migrations are pending against production. Deploying without §2 fails —
safely, before traffic, because `deploy.sh` dies on a failed `migrate deploy` —
but it fails.

---

## 1. The destructive migration — CHECK THIS FIRST

`20260806130000_retire_conversation_store` ends with:

```sql
DROP TABLE IF EXISTS "conversation_messages";
DROP TABLE IF EXISTS "conversation_threads";
```

Neither that migration nor `20260806120000_merge_omnichannel_inboxes` contains a
single `INSERT`. **Nothing copies this data into `key_inbox_*` first.** The
migration also NULLs `message_intakes.thread_id` for every row whose thread is
not already in `key_inbox_threads`.

On `main` these tables were presumably already dead. On production they were
written by MessageIntakeOrchestrator, so they may hold live inbox history.

```bash
ssh root@37.27.27.0
docker exec keyflowos-db-1 psql -U postgres -d keyflowos -c \
  "SELECT (SELECT count(*) FROM conversation_threads)  AS threads,
          (SELECT count(*) FROM conversation_messages) AS messages,
          (SELECT count(*) FROM message_intakes
             WHERE thread_id IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM key_inbox_threads t
                                WHERE t.id = message_intakes.thread_id)) AS intakes_to_be_orphaned;"
```

- **All zero** → proceed to §2.
- **Any non-zero** → STOP. The deploy discards that history and silently detaches
  those intakes. Decide deliberately: write a data-migration first, or accept the
  loss on the record. Do not discover this afterwards.

---

## 2. Reconcile the migration history

Production has never seen `0_baseline`. It holds **433 unguarded `CREATE TABLE`
statements** against a database that already has 443 tables, so `migrate deploy`
hits `42P07`, records a failed migration, and every future deploy dies on
`P3009`.

`0_baseline` must be marked applied *without running*. That assertion is only
true if production's schema already matches what `0_baseline` describes — so
check before asserting it.

### 2a. Back up first, and verify the backup

```bash
ssh root@37.27.27.0
cd /opt/keyflowos
docker exec keyflowos-db-1 pg_dump -U postgres keyflowos > /root/pre-forkclose-$(date +%F-%H%M%S).sql
grep -c "^CREATE TABLE" /root/pre-forkclose-*.sql     # expect ~443, not 0
```

A dump that exists is not a dump that worked. The count is the check.

### 2b. Gate: is the delta exactly what is expected?

I built a production-equivalent database locally (only the 8 migrations
production already has) and diffed it against the merged schema. **This is the
complete expected delta.** Anything else appearing in production's diff is a
signal to stop.

```
[+] Added tables      user_identities, risc_events
[-] Removed tables    conversation_messages, conversation_threads   <- see §1
[*] key_inbox_messages   + ai_approved, ai_draft, intent, raw_payload, role, sentiment
[*] key_inbox_threads    + assigned_role, channel_id, resolved_at
                         + index (contact_id), + FK (contact_id)
[*] message_intakes      FK on thread_id dropped and re-added
[*] risc_events          + unique (jti), + index (received_at), + index (provider_subject)
[*] user_identities      + index (user_id), + unique (provider, provider_subject), + FK (user_id)
[*] users                + meta_data
```

Run the same diff against the real database:

```bash
cd /opt/keyflowos/packages/db
npx prisma migrate diff \
  --from-url "$DATABASE_URL" \
  --to-schema-datamodel ./prisma/schema.prisma
```

Compare it line by line with the block above. Extra `Removed column`, `Removed
table` or `Dropped` entries beyond the two conversation tables mean production
has drifted from what the merged schema expects — stop and bring the output back.

`scripts/prepare-production-db.ps1` automates this, but its gate was calibrated
for a **one**-migration delta (`flow_sessions.user_id`) and still refers to
Render. Against this branch it will refuse and invite `-Force`. Prefer the manual
diff above, or recalibrate the script first.

### 2c. Record the baseline

Only after 2b matches:

```bash
cd /opt/keyflowos/packages/db
npx prisma migrate resolve --applied 0_baseline
npx prisma migrate status        # 0_baseline applied; 5 still pending
```

The five that remain are meant to run: `add_risc_user_identity`,
`add_user_metadata`, `flow_session_user_scope`, `merge_omnichannel_inboxes`,
`retire_conversation_store`.

The 17 rows in `_prisma_migrations` naming migrations that no longer exist in the
repo are expected — main squashed them into `0_baseline`. `migrate deploy`
ignores unknown applied rows.

---

## 3. Deploy

```bash
cd /opt/keyflowos
./scripts/deploy.sh merge/fork-close
```

`deploy.sh` backs up, verifies the dump, tags rollback images from the *running*
containers, migrates before routing traffic, and asserts `/healthz` reports the
commit it built. It has no migration-reconciliation logic, which is why §2 is a
separate manual step.

---

## 4. Verify

```bash
# the deployed commit is the one we built, not "unknown"
curl -s https://<host>/healthz | jq '{commit, status}'

# the genome gate is wired again
curl -s https://<host>/app | grep -c "Checking your Business Genome"

# tenant isolation: the cross-tenant probe must land in the CALLER's business
```

Re-run the cross-business write probe used on 2026-08-07. The row must appear in
the caller's own business, not the target's.

Then fast-forward:

```bash
git checkout main && git merge --ff-only merge/fork-close && git push origin main
git push origin --delete integration/2026-07-consolidation hotfix/tenant-security-2026-08
```

---

## Rollback

Before §3: `git checkout main`, nothing has changed.

After §3: the `:rollback` image tags `deploy.sh` created, under a minute. If
migrations already ran, restore the §2a dump — this is the only reason that dump
must be verified rather than assumed.

---

## What is already verified, so you do not re-check it

| Check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm typecheck --continue` | 7/7 workspaces, exit 0 |
| `apps/server` vitest | 357 files, 3,256 tests, exit 0 |
| `apps/web` vitest | 13 files, 132 tests, exit 0 |
| Six guard specs | unmodified, passing |
| `migrate deploy` → empty database | exit 0, 443 tables |
| `migrate diff` → merged schema | "No difference detected" |
| `commonjs-compat` | passing — the server can `require()` every dependency |

`packages/{db,api,shared,ui}` define no test script; nothing was skipped there.

**Lint is red — 8 errors — and was already red on `main`.** Seven are in files
byte-identical to main under an identical eslint config; the eighth is in a file
integration added. Not a merge regression, and not worth changing React effect
semantics on the eve of a deploy.

## Known, deliberate, not blockers

- `execute_custom_logic` (tier 3, model-authored JS with a local `spawn` fallback
  when E2B is unconfigured) is reachable by `operator` only. integration had it
  on `general`, the role attached to every chat request.
- `KeyContextualSuggestions` and `ComposeFab` lose their components and imports
  together, as part of integration's V2 chat work. A deliberate drop, unlike the
  genome gate, whose hook survived orphaned — which is what identified that one
  as accidental.
- `/keystore/admin/*` is reachable by any member under both resolutions. Neither
  side checks an admin or owner role on a controller named `admin`. Pre-existing;
  worth a follow-up.
