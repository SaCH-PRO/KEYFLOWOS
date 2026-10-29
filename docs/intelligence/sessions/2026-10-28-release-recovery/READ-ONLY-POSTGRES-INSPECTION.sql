-- KEYFLOWOS: 2026-10-28 CONNECTED SUPABASE-ONLY read-only observation.
-- NOT a generic production/VPS inspection script. The connected Supabase
-- project is NOT established as the application's running production DB.
-- Run ONLY against the specifically identified connected Supabase project,
-- with authorized least-privilege diagnostic SELECT access. Do not use this
-- script unchanged on the standalone VPS PostgreSQL database: it assumes
-- Supabase roles anon/authenticated, auth.users, and named public app tables.
-- These SELECT statements return aggregates, migration *names*, extension
-- names and catalog metadata only. No account content, secrets or customer rows.
-- SQL is NOT a migration and grants no permissions.
-- For actual production: verify the live host, auth provider and database
-- identity first; devise a separate, schema-aware read-only inspection plan.
-- Historical observations must be rerun, target-labeled and timestamped.

-- 1. Timestamp / server version.
SELECT now() AS observed_at, current_database() AS database_name,
       current_setting('server_version') AS postgres_version;

-- 2. Physical ordinary-table inventory and RLS coverage by schema.
SELECT n.nspname AS schema_name,
       COUNT(*)::int AS table_count,
       COUNT(*) FILTER (WHERE c.relrowsecurity)::int AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r' AND n.nspname IN ('public', 'auth', 'storage')
GROUP BY n.nspname ORDER BY n.nspname;

-- 3. Non-RLS public tables with direct anon/authenticated role access.
-- This does NOT prove that functions/views/privileged backend code are safe.
SELECT COUNT(*)::int AS public_tables,
       COUNT(*) FILTER (WHERE NOT c.relrowsecurity)::int AS without_rls,
       COUNT(*) FILTER (
         WHERE NOT c.relrowsecurity AND (
           has_table_privilege('anon', c.oid, 'SELECT')
           OR has_table_privilege('authenticated', c.oid, 'SELECT')
           OR has_table_privilege('anon', c.oid, 'INSERT')
           OR has_table_privilege('authenticated', c.oid, 'INSERT')
           OR has_table_privilege('anon', c.oid, 'UPDATE')
           OR has_table_privilege('authenticated', c.oid, 'UPDATE')
         )
       )::int AS without_rls_with_client_role_privilege
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r';

-- 4. App identity/business aggregates; do not treat rows as disposable.
SELECT (SELECT count(*) FROM public.businesses)::int AS businesses,
       (SELECT count(*) FROM public.memberships)::int AS memberships,
       (SELECT count(*) FROM public.users)::int AS app_users,
       (SELECT count(*) FROM auth.users)::int AS auth_users;

-- 5. Existing Prisma migration lineage. The old 2025 history is NOT
-- equivalent to declaring the current schema baseline already applied.
SELECT migration_name,
       finished_at IS NOT NULL AS finished,
       rolled_back_at IS NOT NULL AS rolled_back
FROM public._prisma_migrations ORDER BY started_at;

-- 6. Relevant extensions.
SELECT extname FROM pg_extension
WHERE extname IN ('vector','pgcrypto','uuid-ossp')
ORDER BY extname;

-- 7. Optional: table names only, to diagnose missing application models.
SELECT tablename FROM pg_tables
WHERE schemaname = 'public' ORDER BY tablename;
