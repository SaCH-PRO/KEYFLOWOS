import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ForbiddenException, UnauthorizedException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, HEADERS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AuthGuard } from '../../core/auth/auth.guard';
import { AdminGuard } from '../../core/auth/admin.guard';
import { AdminPlatformModule } from './admin-platform.module';
import { AdminOpsConsoleController } from './admin-ops-console.controller';
import { AdminOpsConsoleService } from './admin-ops-console.service';

function makeExecutionContext(req: Record<string, unknown>) {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as never;
}

function makeFakeRepo(opts: {
  statusJson?: unknown;
  orchestratorState?: string;
  createWorkspaceMarker?: boolean;
}) {
  const dir = mkdtempSync(join(tmpdir(), 'kf-ops-console-'));
  mkdirSync(join(dir, 'docs/reconstruction/handoff'), { recursive: true });
  if (opts.createWorkspaceMarker) {
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n', 'utf8');
  }
  if (opts.statusJson !== undefined) {
    writeFileSync(
      join(dir, 'docs/reconstruction/handoff/V1-STATUS.json'),
      typeof opts.statusJson === 'string' ? opts.statusJson : JSON.stringify(opts.statusJson),
      'utf8',
    );
  }
  if (opts.orchestratorState !== undefined) {
    writeFileSync(
      join(dir, 'docs/reconstruction/handoff/ORCHESTRATOR-STATE.md'),
      opts.orchestratorState,
      'utf8',
    );
  }
  return dir;
}

describe('OPS-CONSOLE-READONLY (server half, D-237 / D-291)', () => {
  const tempDirs: string[] = [];
  const origEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.restoreAllMocks();
    while (tempDirs.length) {
      const d = tempDirs.pop()!;
      rmSync(d, { recursive: true, force: true });
    }
  });

  it('OPS-01: controller enforces owner-only AuthGuard + AdminGuard (D-291), Cache-Control: no-store, and exposes GET read-only routes only', () => {
    const routePath = Reflect.getMetadata(PATH_METADATA, AdminOpsConsoleController);
    expect(routePath).toBe('api/admin/ops');

    const guards = Reflect.getMetadata(GUARDS_METADATA, AdminOpsConsoleController) as unknown[];
    expect(guards).toEqual([AuthGuard, AdminGuard]);

    // Strictly read-only: at least one GET handler, and every decorated handler must be GET
    const proto = AdminOpsConsoleController.prototype;
    const handlerNames = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
    const getHandlers: string[] = [];
    for (const name of handlerNames) {
      const fn = (proto as unknown as Record<string, unknown>)[name];
      if (typeof fn !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, fn);
      if (method !== undefined) {
        expect(method, `handler ${name} must be GET`).toBe(RequestMethod.GET);
        getHandlers.push(name);
      }
    }
    expect(getHandlers.length).toBeGreaterThanOrEqual(1);

    // Security MINOR-5: private engineering console sets Cache-Control: no-store
    const headers = Reflect.getMetadata(HEADERS_METADATA, proto.getConsole) as
      | Array<{ name: string; value: string }>
      | undefined;
    expect(headers).toEqual(
      expect.arrayContaining([{ name: 'Cache-Control', value: 'no-store' }]),
    );

    // Unauthenticated, non-owner, and Supabase SUPER_ADMIN are refused; only local HMAC SUPER_ADMIN passes
    const authGuard = new AuthGuard();
    const adminGuard = new AdminGuard();
    expect(() => authGuard.canActivate(makeExecutionContext({}))).toThrow(UnauthorizedException);
    expect(() => adminGuard.canActivate(makeExecutionContext({}))).toThrow(ForbiddenException);
    expect(() =>
      adminGuard.canActivate(
        makeExecutionContext({ authKind: 'admin', user: { id: 'u1', role: 'USER', authKind: 'admin' } }),
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      adminGuard.canActivate(
        makeExecutionContext({ authKind: 'supabase', user: { id: 'u1', role: 'SUPER_ADMIN', authKind: 'supabase' } }),
      ),
    ).toThrow(ForbiddenException);
    expect(
      adminGuard.canActivate(
        makeExecutionContext({ authKind: 'admin', user: { id: 'u1', role: 'SUPER_ADMIN', authKind: 'admin' } }),
      ),
    ).toBe(true);

    // Module registration check
    const moduleControllers = Reflect.getMetadata('controllers', AdminPlatformModule) as unknown[];
    const moduleProviders = Reflect.getMetadata('providers', AdminPlatformModule) as unknown[];
    expect(moduleControllers).toContain(AdminOpsConsoleController);
    expect(moduleProviders).toContain(AdminOpsConsoleService);
  });

  it('OPS-02: returns real v1Progress, latestMain, openPrs, paginated newest controlRoom, and real-format blockers without fabricating or leaking secrets', async () => {
    const now = new Date('2026-11-28T04:00:00Z');
    const dir = makeFakeRepo({
      statusJson: {
        _generated: {
          main_sha: '4fc49343c26b5a2fec0cabc3d060298a7730201b',
          main_commit_date: '2026-11-28T03:31:51Z',
        },
        summary: {
          packets: 396,
          points: 700,
          by_status: {
            done: { packets: 280, points: 500, pct_by_points: 71.4 },
            'in-progress': { packets: 5, points: 10, pct_by_points: 1.4 },
            todo: { packets: 111, points: 190, pct_by_points: 27.2 },
          },
          by_track: {
            launch: { done: 200, 'in-progress': 3, todo: 20, total: 223 },
          },
          uncertain: ['P161'],
          todo_with_dependencies_met: 15,
          todo_with_dependencies_met_launch: 8,
        },
      },
      orchestratorState: [
        '# Orchestrator state',
        '',
        'Last written: 2026-11-28 03:30 UTC by acting orchestrator.',
        '',
        '## 4. Open questions waiting for the owner (ask together)',
        '',
        '1. **Q50**: RR-DB-CRYPTO-PROD-GUARD production key policy',
        '2. **Q68**: KEY-TOOL-ALLOWLIST R0 amendment',
      ].join('\n'),
    });
    tempDirs.push(dir);

    const secretToken = 'ghp_SUPER_SECRET_TOKEN_DO_NOT_LEAK_999';
    process.env.OPS_CONSOLE_GITHUB_TOKEN = secretToken;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_DO_NOT_LEAK_888';
    process.env.VERCEL_TOKEN = 'vrc_secret_DO_NOT_LEAK_777';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-DO_NOT_LEAK_666';

    const requestedUrls: string[] = [];
    const mockFetch = vi.fn(async (url: string) => {
      requestedUrls.push(url);
      if (url.endsWith('/commits/main')) {
        return new Response(
          JSON.stringify({
            sha: '4fc49343c26b5a2fec0cabc3d060298a7730201b',
            html_url: 'https://github.com/KEYFLOWOS/KEYFLOWOS/commit/4fc49343c26b5a2fec0cabc3d060298a7730201b',
            commit: {
              message: 'Wave M85 (#294)\n\nDetails',
              committer: { name: 'GitHub', date: '2026-11-28T03:31:51Z' },
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/pulls?state=open')) {
        return new Response(
          JSON.stringify([
            {
              number: 284,
              title: 'Wave M40: EXPENSES-HUB-3',
              draft: false,
              updated_at: '2026-11-28T03:31:00Z',
              html_url: 'https://github.com/KEYFLOWOS/KEYFLOWOS/pull/284',
              head: { sha: 'e2f5e44400000000000000000000000000000000', ref: 'wave/v1-wave-m40' },
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/check-runs')) {
        return new Response(
          JSON.stringify({
            total_count: 2,
            check_runs: [
              { name: 'CI verdict (gating jobs)', status: 'completed', conclusion: 'success' },
              { name: 'Type Check', status: 'in_progress', conclusion: null },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      // MAJOR-1: GitHub /issues/{n}/comments ignores sort/direction; must query issue count & tail pages
      if (/\/issues\/273$/.test(url)) {
        return new Response(JSON.stringify({ number: 273, comments: 25 }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }
      if (url.includes('/issues/273/comments?per_page=10&page=3')) {
        return new Response(
          JSON.stringify([
            {
              id: 21,
              created_at: '2026-11-28T03:41:00Z',
              html_url: 'https://github.com/KEYFLOWOS/KEYFLOWOS/issues/273#issuecomment-21',
              user: { login: 'SaCH-PRO' },
              body: 'Comment 21',
            },
            {
              id: 22,
              created_at: '2026-11-28T03:42:00Z',
              html_url: 'https://github.com/KEYFLOWOS/KEYFLOWOS/issues/273#issuecomment-22',
              user: { login: 'SaCH-PRO' },
              body: 'Comment 22',
            },
            {
              id: 23,
              created_at: '2026-11-28T03:43:00Z',
              html_url: 'https://github.com/KEYFLOWOS/KEYFLOWOS/issues/273#issuecomment-23',
              user: { login: 'SaCH-PRO' },
              body: 'Comment 23',
            },
            {
              id: 24,
              created_at: '2026-11-28T03:50:00Z',
              html_url: 'https://github.com/KEYFLOWOS/KEYFLOWOS/issues/273#issuecomment-24',
              user: { login: 'SaCH-PRO' },
              body: '\n\n   RETURN second-newest\nLine 2',
            },
            {
              id: 25,
              created_at: '2026-11-28T03:57:52Z',
              html_url: 'https://github.com/KEYFLOWOS/KEYFLOWOS/issues/273#issuecomment-25',
              user: { login: 'SaCH-PRO' },
              body: 'RETURN newest-comment\nLine 2',
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      if (url.includes('/issues/273/comments?per_page=10&page=2')) {
        return new Response(
          JSON.stringify(
            Array.from({ length: 10 }, (_, idx) => ({
              id: 11 + idx,
              created_at: `2026-11-28T03:${String(10 + idx).padStart(2, '0')}:00Z`,
              html_url: `https://github.com/KEYFLOWOS/KEYFLOWOS/issues/273#issuecomment-${11 + idx}`,
              user: { login: 'SaCH-PRO' },
              body: `Comment ${11 + idx}`,
            })),
          ),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not Found', { status: 404 });
    });

    const service = new AdminOpsConsoleService({
      repoRoot: dir,
      fetchImpl: mockFetch as unknown as typeof fetch,
      now: () => now,
      cacheTtlMs: 0,
    });
    const controller = new AdminOpsConsoleController(service);
    const res = await controller.getConsole();

    expect(res.readOnly).toBe(true);
    expect(res.generatedAt).toBe('2026-11-28T04:00:00.000Z');

    // MAJOR-1: must never pass unsupported sort/direction params to issue comments endpoint
    expect(requestedUrls.some((u) => u.includes('sort=created'))).toBe(false);

    // v1Progress (MAJOR-5: never fabricate stalledCount: 0 when absent)
    expect(res.v1Progress.status).toBe('ok');
    expect(res.v1Progress.sourceTimestamp).toBe('2026-11-28T03:31:51Z');
    expect(res.v1Progress.data?.donePackets).toBe(280);
    expect(res.v1Progress.data?.totalPackets).toBe(396);
    expect(res.v1Progress.data?.launchDone).toBe(200);
    expect(res.v1Progress.data?.stalledCount).toBeNull();
    expect(res.v1Progress.data?.uncertainCount).toBe(1);

    // latestMain
    expect(res.latestMain.status).toBe('ok');
    expect(res.latestMain.sourceTimestamp).toBe('2026-11-28T03:31:51Z');
    expect(res.latestMain.data?.shortSha).toBe('4fc49343');
    expect(res.latestMain.data?.subject).toBe('Wave M85 (#294)');

    // openPrs
    expect(res.openPrs.status).toBe('ok');
    expect(res.openPrs.sourceTimestamp).toBe('2026-11-28T03:31:00Z');
    expect(res.openPrs.data?.items).toHaveLength(1);
    expect(res.openPrs.data?.items[0].number).toBe(284);
    expect(res.openPrs.data?.items[0].ciState).toBe('pending');

    // controlRoom (newest 10 across page 3 + page 2, newest-first, blank leading lines skipped)
    expect(res.controlRoom.status).toBe('ok');
    expect(res.controlRoom.sourceTimestamp).toBe('2026-11-28T03:57:52Z');
    expect(res.controlRoom.data?.issueNumber).toBe(273);
    expect(res.controlRoom.data?.items).toHaveLength(10);
    expect(res.controlRoom.data?.items[0].id).toBe(25);
    expect(res.controlRoom.data?.items[1].id).toBe(24);
    expect(res.controlRoom.data?.items[1].excerpt).toBe('RETURN second-newest');
    expect(res.controlRoom.data?.items[9].id).toBe(16);

    // blockers (MAJOR-2: numbered items under real heading)
    expect(res.blockers.status).toBe('ok');
    expect(res.blockers.sourceTimestamp).toBe('2026-11-28T03:30:00Z');
    expect(res.blockers.data?.items).toEqual([
      '**Q50**: RR-DB-CRYPTO-PROD-GUARD production key policy',
      '**Q68**: KEY-TOOL-ALLOWLIST R0 amendment',
    ]);

    // Zero credentials anywhere in serialized response
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(secretToken);
    expect(serialized).not.toContain('sb_secret_DO_NOT_LEAK_888');
    expect(serialized).not.toContain('vrc_secret_DO_NOT_LEAK_777');
    expect(serialized).not.toContain('sk-ant-DO_NOT_LEAK_666');
    expect(serialized).not.toContain('Bearer ');
    expect(serialized).not.toContain('Authorization');
  });

  it('OPS-03: marks old/missing-timestamp local files stale, rejects coerced null/empty counts, and handles upstream failures without leaking secrets', async () => {
    const now = new Date('2026-11-28T04:00:00Z');
    const dir = makeFakeRepo({
      statusJson: {
        _generated: { main_sha: 'aaaaaaaa00000000000000000000000000000000', main_commit_date: '2026-11-20T00:00:00Z' },
        summary: {
          packets: 10,
          points: 10,
          by_status: {
            done: { packets: 5, points: 5, pct_by_points: 50 },
            'in-progress': { packets: 1, points: 2 },
            todo: { packets: 4, points: 3 },
          },
          todo_with_dependencies_met: 2,
          todo_with_dependencies_met_launch: 1,
        },
      },
    });
    tempDirs.push(dir);

    const secretToken = 'ghp_LEAK_TEST_TOKEN_12345';
    process.env.OPS_CONSOLE_GITHUB_TOKEN = secretToken;
    const failingFetch = vi.fn(async () => {
      throw new Error(`request failed with header Authorization: Bearer ${secretToken}`);
    });

    const service = new AdminOpsConsoleService({
      repoRoot: dir,
      fetchImpl: failingFetch as unknown as typeof fetch,
      now: () => now,
      cacheTtlMs: 0,
    });
    const res = await service.getSnapshot();

    expect(res.v1Progress.status).toBe('stale');
    expect(res.v1Progress.sourceTimestamp).toBe('2026-11-20T00:00:00Z');

    expect(res.blockers.status).toBe('unavailable');
    expect(res.blockers.data).toBeNull();
    expect(res.blockers.sourceTimestamp).toBeNull();

    expect(res.latestMain.status).toBe('unavailable');
    expect(res.latestMain.data).toBeNull();
    expect(res.openPrs.status).toBe('unavailable');
    expect(res.openPrs.data).toBeNull();
    expect(res.controlRoom.status).toBe('unavailable');
    expect(res.controlRoom.data).toBeNull();

    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(secretToken);
    expect(serialized).not.toContain('Bearer ');

    // MAJOR-5: null / "" counts must NOT coerce to 0
    const dirBadCounts = makeFakeRepo({
      statusJson: {
        _generated: { main_commit_date: '2026-11-28T03:50:00Z' },
        summary: { packets: null, by_status: { done: { packets: '' } } },
      },
    });
    tempDirs.push(dirBadCounts);
    delete process.env.OPS_CONSOLE_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    const svcBadCounts = new AdminOpsConsoleService({
      repoRoot: dirBadCounts,
      fetchImpl: failingFetch as unknown as typeof fetch,
      now: () => now,
      cacheTtlMs: 0,
    });
    const badRes = await svcBadCounts.getSnapshot();
    expect(badRes.v1Progress.status).toBe('unavailable');
    expect(badRes.v1Progress.data).toBeNull();

    // Missing main_commit_date marks v1Progress explicitly stale
    const dirNoDate = makeFakeRepo({
      statusJson: {
        _generated: { main_sha: 'abc12345' },
        summary: {
          packets: 10,
          by_status: { done: { packets: 5, pct_by_points: 50 } },
        },
      },
    });
    tempDirs.push(dirNoDate);
    const svcNoDate = new AdminOpsConsoleService({
      repoRoot: dirNoDate,
      fetchImpl: failingFetch as unknown as typeof fetch,
      now: () => now,
      cacheTtlMs: 0,
    });
    const noDateRes = await svcNoDate.getSnapshot();
    expect(noDateRes.v1Progress.status).toBe('stale');
    expect(noDateRes.v1Progress.sourceTimestamp).toBeNull();
  });

  it('OPS-04: rejects malformed/dot-segment OPS_CONSOLE_GITHUB_REPO, non-safe-integer issue, oversized files, and off-origin htmlUrl', async () => {
    const dir = makeFakeRepo({});
    tempDirs.push(dir);
    const spyFetch = vi.fn();

    // Unconfigured GitHub token -> unavailable, zero network calls
    delete process.env.OPS_CONSOLE_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    const svcNoTok = new AdminOpsConsoleService({
      repoRoot: dir,
      fetchImpl: spyFetch as unknown as typeof fetch,
      cacheTtlMs: 0,
    });
    const r1 = await svcNoTok.getSnapshot();
    expect(r1.latestMain.status).toBe('unavailable');
    expect(r1.openPrs.status).toBe('unavailable');
    expect(r1.controlRoom.status).toBe('unavailable');
    expect(spyFetch).not.toHaveBeenCalled();

    // Security MINOR-1: SSRF + dot-segment path traversal rejected with zero fetches
    process.env.OPS_CONSOLE_GITHUB_TOKEN = 'ghp_valid_token';
    for (const badSlug of [
      'evil.example.com/foo#bar',
      '../user',
      'owner/..',
      'owner/.',
      './repo',
      'bad.owner/repo',
    ]) {
      process.env.OPS_CONSOLE_GITHUB_REPO = badSlug;
      const svcBad = new AdminOpsConsoleService({
        repoRoot: dir,
        fetchImpl: spyFetch as unknown as typeof fetch,
        cacheTtlMs: 0,
      });
      const r = await svcBad.getSnapshot();
      expect(r.latestMain.status, `slug ${badSlug} must fail closed`).toBe('unavailable');
      expect(r.canonicalControlPlane.repository).toBeNull();
    }
    expect(spyFetch).not.toHaveBeenCalled();

    // Non-safe integer falls back to default 273
    process.env.OPS_CONSOLE_GITHUB_REPO = 'KEYFLOWOS/KEYFLOWOS';
    process.env.OPS_CONSOLE_CONTROL_ROOM_ISSUE = '1e23';
    delete process.env.OPS_CONSOLE_GITHUB_TOKEN;
    const svcHugeIssue = new AdminOpsConsoleService({
      repoRoot: dir,
      fetchImpl: spyFetch as unknown as typeof fetch,
      cacheTtlMs: 0,
    });
    const rIssue = await svcHugeIssue.getSnapshot();
    expect(rIssue.canonicalControlPlane.controlRoomIssue).toBe(273);

    // Security MINOR-4: oversized local file (>2 MiB) fails closed
    const hugeDir = makeFakeRepo({
      orchestratorState: 'x'.repeat(2 * 1024 * 1024 + 64),
    });
    tempDirs.push(hugeDir);
    const svcHuge = new AdminOpsConsoleService({
      repoRoot: hugeDir,
      fetchImpl: spyFetch as unknown as typeof fetch,
      cacheTtlMs: 0,
    });
    const rHuge = await svcHuge.getSnapshot();
    expect(rHuge.blockers.status).toBe('unavailable');
    expect(rHuge.blockers.data).toBeNull();

    // Security MINOR-2: javascript: and off-origin html_url are sanitized to ''
    process.env.OPS_CONSOLE_GITHUB_TOKEN = 'ghp_valid_token';
    process.env.OPS_CONSOLE_CONTROL_ROOM_ISSUE = '273';
    const xssFetch = vi.fn(async (url: string) => {
      if (url.endsWith('/commits/main')) {
        return new Response(
          JSON.stringify({
            sha: '1111111122222222333333334444444455555555',
            html_url: 'javascript:alert(1)',
            commit: { message: 'msg', committer: { name: 'a', date: '2026-11-28T03:00:00Z' } },
          }),
          { status: 200 },
        );
      }
      if (url.includes('/pulls?state=open')) {
        return new Response(
          JSON.stringify([
            {
              number: 1,
              title: 'PR',
              updated_at: '2026-11-28T03:00:00Z',
              html_url: 'https://evil.example.com/pull/1',
              head: { sha: 'aaaaaaa', ref: 'x' },
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes('/check-runs')) {
        return new Response(JSON.stringify({ total_count: 0, check_runs: [] }), { status: 200 });
      }
      if (/\/issues\/273$/.test(url)) {
        return new Response(JSON.stringify({ number: 273, comments: 0 }), { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    });
    const svcXss = new AdminOpsConsoleService({
      repoRoot: dir,
      fetchImpl: xssFetch as unknown as typeof fetch,
      cacheTtlMs: 0,
    });
    const rXss = await svcXss.getSnapshot();
    expect(rXss.latestMain.data?.htmlUrl).toBe('');
    expect(rXss.openPrs.data?.items[0].htmlUrl).toBe('');
    expect(rXss.controlRoom.status).toBe('ok');
    expect(rXss.controlRoom.data?.items).toEqual([]);
  });

  it('OPS-05: handles ciState edge cases, numeric timestamp ordering, live-fetch freshness consistency, TTL caching/dedup, and real repo files', async () => {
    const now = new Date('2026-11-28T04:00:00Z');
    const dir = makeFakeRepo({});
    tempDirs.push(dir);
    process.env.OPS_CONSOLE_GITHUB_TOKEN = 'ghp_valid_token';
    process.env.OPS_CONSOLE_GITHUB_REPO = 'KEYFLOWOS/KEYFLOWOS';

    let fetchCount = 0;
    const edgeFetch = vi.fn(async (url: string) => {
      fetchCount += 1;
      if (url.endsWith('/commits/main')) {
        // Older than 24h commit on main, fetched live from GitHub -> status 'ok', sourceTimestamp preserved
        return new Response(
          JSON.stringify({
            sha: '9999999900000000000000000000000000000000',
            html_url: 'https://github.com/KEYFLOWOS/KEYFLOWOS/commit/99999999',
            commit: { message: 'Old commit', committer: { name: 'dev', date: '2026-11-20T00:00:00Z' } },
          }),
          { status: 200 },
        );
      }
      if (url.includes('/pulls?state=open')) {
        return new Response(
          JSON.stringify([
            {
              number: 10,
              title: 'Failing PR',
              updated_at: '2026-11-28T04:30:00+02:00', // 02:30Z
              html_url: 'https://github.com/KEYFLOWOS/KEYFLOWOS/pull/10',
              head: { sha: '1111111', ref: 'a' },
            },
            {
              number: 11,
              title: 'Mixed success + skipped PR',
              updated_at: '2026-11-28T03:00:00Z', // 03:00Z (actually newer than 04:30+02:00!)
              html_url: 'https://github.com/KEYFLOWOS/KEYFLOWOS/pull/11',
              head: { sha: '2222222', ref: 'b' },
            },
            {
              number: 12,
              title: 'All skipped PR',
              updated_at: '2026-11-28T02:00:00Z',
              html_url: 'https://github.com/KEYFLOWOS/KEYFLOWOS/pull/12',
              head: { sha: '3333333', ref: 'c' },
            },
            {
              number: 13,
              title: 'Stale/null conclusion PR',
              updated_at: '2026-11-28T02:00:00Z',
              html_url: 'https://github.com/KEYFLOWOS/KEYFLOWOS/pull/13',
              head: { sha: '4444444', ref: 'd' },
            },
            {
              number: 14,
              title: 'Truncated check-runs PR',
              updated_at: '2026-11-28T02:00:00Z',
              html_url: 'https://github.com/KEYFLOWOS/KEYFLOWOS/pull/14',
              head: { sha: '5555555', ref: 'e' },
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes('/commits/1111111/check-runs')) {
        return new Response(
          JSON.stringify({ total_count: 1, check_runs: [{ status: 'completed', conclusion: 'failure' }] }),
          { status: 200 },
        );
      }
      if (url.includes('/commits/2222222/check-runs')) {
        return new Response(
          JSON.stringify({
            total_count: 2,
            check_runs: [
              { status: 'completed', conclusion: 'success' },
              { status: 'completed', conclusion: 'skipped' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/commits/3333333/check-runs')) {
        return new Response(
          JSON.stringify({
            total_count: 2,
            check_runs: [
              { status: 'completed', conclusion: 'skipped' },
              { status: 'completed', conclusion: 'neutral' },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes('/commits/4444444/check-runs')) {
        return new Response(
          JSON.stringify({ total_count: 1, check_runs: [{ status: 'completed', conclusion: 'stale' }] }),
          { status: 200 },
        );
      }
      if (url.includes('/commits/5555555/check-runs')) {
        return new Response(
          JSON.stringify({ total_count: 105, check_runs: [{ status: 'completed', conclusion: 'success' }] }),
          { status: 200 },
        );
      }
      if (/\/issues\/273$/.test(url)) {
        return new Response(JSON.stringify({ number: 273, comments: 0 }), { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    });

    const svc = new AdminOpsConsoleService({
      repoRoot: dir,
      fetchImpl: edgeFetch as unknown as typeof fetch,
      now: () => now,
      cacheTtlMs: 30_000,
    });

    // Security MINOR-3: concurrent calls coalesce and cached call does not re-fetch
    const [rA, rB] = await Promise.all([svc.getSnapshot(), svc.getSnapshot()]);
    const callsAfterFirst = fetchCount;
    const rC = await svc.getSnapshot();
    expect(fetchCount).toBe(callsAfterFirst);
    expect(rA).toEqual(rB);
    expect(rC).toEqual(rA);

    // Correctness MINOR-3: live GitHub main fetch is 'ok' with honest old sourceTimestamp
    expect(rA.latestMain.status).toBe('ok');
    expect(rA.latestMain.sourceTimestamp).toBe('2026-11-20T00:00:00Z');

    // Correctness MINOR-1: numeric timestamp ordering beats lexicographic (+02:00 vs Z)
    expect(rA.openPrs.sourceTimestamp).toBe('2026-11-28T03:00:00Z');

    // Correctness MINOR-2: ciState edge cases
    const byNum = new Map(rA.openPrs.data!.items.map((i) => [i.number, i.ciState]));
    expect(byNum.get(10)).toBe('failing');
    expect(byNum.get(11)).toBe('passing');
    expect(byNum.get(12)).toBe('unknown');
    expect(byNum.get(13)).toBe('unknown');
    expect(byNum.get(14)).toBe('unknown');

    // MAJOR-2: real repo ORCHESTRATOR-STATE.md parses non-empty blockers
    delete process.env.OPS_CONSOLE_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    const realRoot = resolve(__dirname, '../../../../..');
    const svcReal = new AdminOpsConsoleService({
      repoRoot: realRoot,
      fetchImpl: edgeFetch as unknown as typeof fetch,
      now: () => now,
      cacheTtlMs: 0,
    });
    const realSnap = await svcReal.getSnapshot();
    expect(realSnap.blockers.status).not.toBe('unavailable');
    expect(realSnap.blockers.data?.items.length ?? 0).toBeGreaterThan(0);
    expect(realSnap.v1Progress.status).not.toBe('unavailable');
    expect(realSnap.v1Progress.data?.totalPackets ?? 0).toBeGreaterThan(0);
  });
});
