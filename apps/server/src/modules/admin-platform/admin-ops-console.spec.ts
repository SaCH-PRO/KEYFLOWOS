import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ForbiddenException, UnauthorizedException, RequestMethod } from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
}) {
  const dir = mkdtempSync(join(tmpdir(), 'kf-ops-console-'));
  mkdirSync(join(dir, 'docs/reconstruction/handoff'), { recursive: true });
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

  it('OPS-01: controller enforces owner-only AuthGuard + AdminGuard (D-291) and exposes GET read-only routes only', () => {
    const routePath = Reflect.getMetadata(PATH_METADATA, AdminOpsConsoleController);
    expect(routePath).toBe('api/admin/ops');

    const guards = Reflect.getMetadata(GUARDS_METADATA, AdminOpsConsoleController) as unknown[];
    expect(guards).toEqual([AuthGuard, AdminGuard]);

    // Strictly read-only: every handler on the controller must be RequestMethod.GET
    const proto = AdminOpsConsoleController.prototype;
    const handlerNames = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
    expect(handlerNames.length).toBeGreaterThanOrEqual(1);
    for (const name of handlerNames) {
      const fn = (proto as unknown as Record<string, unknown>)[name];
      if (typeof fn !== 'function') continue;
      const method = Reflect.getMetadata(METHOD_METADATA, fn);
      if (method !== undefined) {
        expect(method, `handler ${name} must be GET`).toBe(RequestMethod.GET);
      }
    }

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

  it('OPS-02: returns real v1Progress, latestMain, openPrs, controlRoom, and blockers with source timestamps (never fabricated)', async () => {
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
          todo_with_dependencies_met: 15,
          todo_with_dependencies_met_launch: 8,
          stalled_ready: 0,
        },
      },
      orchestratorState: [
        '# Orchestrator state',
        '',
        'Last written: 2026-11-28 03:30 UTC by acting orchestrator.',
        '',
        '## 4. Open owner questions (blockers)',
        '- Q50: RR-DB-CRYPTO-PROD-GUARD production key policy',
        '- Q68: KEY-TOOL-ALLOWLIST R0 amendment',
      ].join('\n'),
    });
    tempDirs.push(dir);

    const secretToken = 'ghp_SUPER_SECRET_TOKEN_DO_NOT_LEAK_999';
    process.env.OPS_CONSOLE_GITHUB_TOKEN = secretToken;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_DO_NOT_LEAK_888';
    process.env.VERCEL_TOKEN = 'vrc_secret_DO_NOT_LEAK_777';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-DO_NOT_LEAK_666';

    const mockFetch = vi.fn(async (url: string) => {
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
      if (url.includes('/issues/273/comments')) {
        return new Response(
          JSON.stringify([
            {
              id: 7233553731,
              created_at: '2026-11-28T03:57:52Z',
              html_url: 'https://github.com/KEYFLOWOS/KEYFLOWOS/issues/273#issuecomment-7233553731',
              user: { login: 'SaCH-PRO' },
              body: 'RETURN RR-SLO-AVAILABILITY-LEDGER\nLine 2',
            },
          ]),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response('Not Found', { status: 404 });
    });

    const service = new AdminOpsConsoleService({
      repoRoot: dir,
      fetchImpl: mockFetch as unknown as typeof fetch,
      now: () => now,
    });
    const controller = new AdminOpsConsoleController(service);
    const res = await controller.getConsole();

    expect(res.readOnly).toBe(true);
    expect(res.generatedAt).toBe('2026-11-28T04:00:00.000Z');

    // v1Progress
    expect(res.v1Progress.status).toBe('ok');
    expect(res.v1Progress.sourceTimestamp).toBe('2026-11-28T03:31:51Z');
    expect(res.v1Progress.data?.donePackets).toBe(280);
    expect(res.v1Progress.data?.totalPackets).toBe(396);
    expect(res.v1Progress.data?.launchDone).toBe(200);

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

    // controlRoom
    expect(res.controlRoom.status).toBe('ok');
    expect(res.controlRoom.sourceTimestamp).toBe('2026-11-28T03:57:52Z');
    expect(res.controlRoom.data?.issueNumber).toBe(273);
    expect(res.controlRoom.data?.items[0].id).toBe(7233553731);

    // blockers
    expect(res.blockers.status).toBe('ok');
    expect(res.blockers.sourceTimestamp).toBe('2026-11-28T03:30:00Z');
    expect(res.blockers.data?.items.length).toBeGreaterThanOrEqual(2);

    // Zero credentials anywhere in serialized response
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(secretToken);
    expect(serialized).not.toContain('sb_secret_DO_NOT_LEAK_888');
    expect(serialized).not.toContain('vrc_secret_DO_NOT_LEAK_777');
    expect(serialized).not.toContain('sk-ant-DO_NOT_LEAK_666');
    expect(serialized).not.toContain('Bearer ');
    expect(serialized).not.toContain('Authorization');
  });

  it('OPS-03: marks old sources explicitly stale and missing/failing sources explicitly unavailable without leaking secrets or fabricating data', async () => {
    const now = new Date('2026-11-28T04:00:00Z');
    // Old status (> 24h old -> stale), missing ORCHESTRATOR-STATE.md -> unavailable
    const dir = makeFakeRepo({
      statusJson: {
        _generated: { main_sha: 'aaaaaaaa00000000000000000000000000000000', main_commit_date: '2026-11-20T00:00:00Z' },
        summary: { packets: 10, points: 10, by_status: { done: { packets: 5, points: 5, pct_by_points: 50 } } },
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

    // Upstream error message containing the token must NEVER leak into the response
    const serialized = JSON.stringify(res);
    expect(serialized).not.toContain(secretToken);
    expect(serialized).not.toContain('Bearer ');
  });

  it('OPS-04: rejects malformed OPS_CONSOLE_GITHUB_REPO (SSRF defense) and unconfigured token without outbound fetch', async () => {
    const dir = makeFakeRepo({});
    tempDirs.push(dir);
    const spyFetch = vi.fn();

    // Unconfigured GitHub token -> unavailable, zero network calls
    delete process.env.OPS_CONSOLE_GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    const svcNoTok = new AdminOpsConsoleService({
      repoRoot: dir,
      fetchImpl: spyFetch as unknown as typeof fetch,
    });
    const r1 = await svcNoTok.getSnapshot();
    expect(r1.latestMain.status).toBe('unavailable');
    expect(r1.openPrs.status).toBe('unavailable');
    expect(r1.controlRoom.status).toBe('unavailable');
    expect(spyFetch).not.toHaveBeenCalled();

    // Malformed repo slug with SSRF characters -> unavailable, zero network calls
    process.env.OPS_CONSOLE_GITHUB_TOKEN = 'ghp_valid_token';
    process.env.OPS_CONSOLE_GITHUB_REPO = 'evil.example.com/foo#bar';
    const svcBadRepo = new AdminOpsConsoleService({
      repoRoot: dir,
      fetchImpl: spyFetch as unknown as typeof fetch,
    });
    const r2 = await svcBadRepo.getSnapshot();
    expect(r2.latestMain.status).toBe('unavailable');
    expect(r2.openPrs.status).toBe('unavailable');
    expect(r2.controlRoom.status).toBe('unavailable');
    expect(spyFetch).not.toHaveBeenCalled();
  });
});
