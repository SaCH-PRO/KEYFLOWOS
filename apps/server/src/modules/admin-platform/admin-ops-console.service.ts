import { Inject, Injectable, Optional } from '@nestjs/common';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const OPS_CONSOLE_OPTIONS = Symbol('OPS_CONSOLE_OPTIONS');

export type OpsSectionStatus = 'ok' | 'stale' | 'unavailable';

export interface OpsSection<T> {
  status: OpsSectionStatus;
  source: string;
  fetchedAt: string;
  sourceTimestamp: string | null;
  data: T | null;
  reason?: string;
}

export interface V1ProgressData {
  mainSha: string | null;
  totalPackets: number;
  donePackets: number;
  inProgressPackets: number;
  todoPackets: number;
  pctByPoints: number;
  launchDone: number | null;
  launchTotal: number | null;
  readyCount: number;
  readyLaunchCount: number;
  stalledCount: number;
}

export interface LatestMainData {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  committedAt: string;
  htmlUrl: string;
}

export interface OpenPrItem {
  number: number;
  title: string;
  draft: boolean;
  headRef: string;
  headSha: string;
  updatedAt: string;
  htmlUrl: string;
  ciState: 'passing' | 'pending' | 'failing' | 'unknown';
}

export interface OpenPrsData {
  items: OpenPrItem[];
}

export interface ControlRoomComment {
  id: number;
  author: string;
  createdAt: string;
  excerpt: string;
  htmlUrl: string;
}

export interface ControlRoomData {
  issueNumber: number;
  items: ControlRoomComment[];
}

export interface BlockersData {
  items: string[];
}

export interface OpsConsoleSnapshot {
  readOnly: true;
  generatedAt: string;
  canonicalControlPlane: {
    repository: string | null;
    controlRoomIssue: number;
  };
  v1Progress: OpsSection<V1ProgressData>;
  latestMain: OpsSection<LatestMainData>;
  openPrs: OpsSection<OpenPrsData>;
  controlRoom: OpsSection<ControlRoomData>;
  blockers: OpsSection<BlockersData>;
}

export interface AdminOpsConsoleOptions {
  repoRoot?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  staleAfterMs?: number;
}

const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000;
const GITHUB_TIMEOUT_MS = 5_000;
const DEFAULT_CONTROL_ROOM_ISSUE = 273;
const DEFAULT_GITHUB_REPO = 'KEYFLOWOS/KEYFLOWOS';
const SAFE_GITHUB_SLUG_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;
const FAILING_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
]);

function discoverRepoRoot(startDir: string): string {
  let cur = resolve(startDir);
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(cur, 'docs', 'reconstruction', 'handoff', 'V1-STATUS.json'))) {
      return cur;
    }
    const parent = dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  return resolve(startDir);
}

function parseTimestampMs(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const ms = Date.parse(raw.trim());
  return Number.isFinite(ms) ? ms : null;
}

function statusFromTimestamp(
  sourceTimestamp: string | null,
  nowMs: number,
  staleAfterMs: number,
): OpsSectionStatus {
  const tsMs = parseTimestampMs(sourceTimestamp);
  if (tsMs === null) return 'stale';
  return nowMs - tsMs > staleAfterMs ? 'stale' : 'ok';
}

function parseOrchestratorLastWritten(markdown: string): string | null {
  const m = markdown.match(/Last written:\s*(\d{4}-\d{2}-\d{2})\s+~?(\d{2}:\d{2})\s*UTC/i);
  if (!m) return null;
  const iso = `${m[1]}T${m[2]}:00Z`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

function extractBlockers(markdown: string): string[] {
  const lines = markdown.split(/\r?\n/);
  const items: string[] = [];
  let inSection = false;
  for (const rawLine of lines) {
    const headingMatch = rawLine.match(/^#{2,4}\s+(.*)$/);
    if (headingMatch) {
      inSection = /open owner questions|blockers/i.test(headingMatch[1]);
      continue;
    }
    if (!inSection) continue;
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      items.push(trimmed.slice(2).trim().slice(0, 240));
    } else if (trimmed.startsWith('|') && !/^\|[\s|:-]+\|$/.test(trimmed) && !/^\|\s*(#|id|question|item)\s*\|/i.test(trimmed)) {
      items.push(trimmed.slice(0, 240));
    }
    if (items.length >= 30) break;
  }
  return items;
}

function resolveGithubConfig(): {
  token: string | null;
  repo: string | null;
  issueNumber: number;
  repoError?: string;
} {
  const rawIssue = Number(process.env.OPS_CONSOLE_CONTROL_ROOM_ISSUE ?? DEFAULT_CONTROL_ROOM_ISSUE);
  const issueNumber =
    Number.isInteger(rawIssue) && rawIssue > 0 ? rawIssue : DEFAULT_CONTROL_ROOM_ISSUE;
  const token =
    (process.env.OPS_CONSOLE_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '').trim() || null;
  const rawRepo = (process.env.OPS_CONSOLE_GITHUB_REPO || DEFAULT_GITHUB_REPO).trim();
  if (!SAFE_GITHUB_SLUG_RE.test(rawRepo)) {
    return { token, repo: null, issueNumber, repoError: 'Invalid GitHub repository configuration' };
  }
  return { token, repo: rawRepo, issueNumber };
}

@Injectable()
export class AdminOpsConsoleService {
  private readonly repoRoot: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly staleAfterMs: number;

  constructor(
    @Optional() @Inject(OPS_CONSOLE_OPTIONS) options?: AdminOpsConsoleOptions,
  ) {
    this.repoRoot = options?.repoRoot ?? discoverRepoRoot(process.cwd());
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.now = options?.now ?? (() => new Date());
    this.staleAfterMs = options?.staleAfterMs ?? DEFAULT_STALE_MS;
  }

  async getSnapshot(): Promise<OpsConsoleSnapshot> {
    const nowDate = this.now();
    const fetchedAt = nowDate.toISOString();
    const nowMs = nowDate.getTime();
    const gh = resolveGithubConfig();

    const v1Progress = this.readV1Progress(fetchedAt, nowMs);
    const blockers = this.readBlockers(fetchedAt, nowMs);

    const [latestMain, openPrs, controlRoom] = await Promise.all([
      this.fetchLatestMain(gh, fetchedAt, nowMs),
      this.fetchOpenPrs(gh, fetchedAt),
      this.fetchControlRoom(gh, fetchedAt),
    ]);

    return {
      readOnly: true,
      generatedAt: fetchedAt,
      canonicalControlPlane: {
        repository: gh.repo,
        controlRoomIssue: gh.issueNumber,
      },
      v1Progress,
      latestMain,
      openPrs,
      controlRoom,
      blockers,
    };
  }

  private readV1Progress(fetchedAt: string, nowMs: number): OpsSection<V1ProgressData> {
    const source = 'docs/reconstruction/handoff/V1-STATUS.json';
    const fullPath = join(this.repoRoot, source);
    if (!existsSync(fullPath)) {
      return {
        status: 'unavailable',
        source,
        fetchedAt,
        sourceTimestamp: null,
        data: null,
        reason: 'Status file not found',
      };
    }
    try {
      const parsed = JSON.parse(readFileSync(fullPath, 'utf8')) as Record<string, unknown>;
      const generated = (parsed._generated ?? {}) as Record<string, unknown>;
      const summary = (parsed.summary ?? {}) as Record<string, unknown>;
      const byStatus = (summary.by_status ?? {}) as Record<string, Record<string, unknown>>;
      const byTrack = (summary.by_track ?? {}) as Record<string, Record<string, unknown>>;

      const sourceTimestamp =
        typeof generated.main_commit_date === 'string' && parseTimestampMs(generated.main_commit_date) !== null
          ? generated.main_commit_date
          : null;
      const totalPackets = Number(summary.packets);
      const donePackets = Number(byStatus.done?.packets);
      if (!Number.isFinite(totalPackets) || !Number.isFinite(donePackets)) {
        return {
          status: 'unavailable',
          source,
          fetchedAt,
          sourceTimestamp,
          data: null,
          reason: 'Status file is missing required packet counts',
        };
      }

      return {
        status: statusFromTimestamp(sourceTimestamp, nowMs, this.staleAfterMs),
        source,
        fetchedAt,
        sourceTimestamp,
        data: {
          mainSha: typeof generated.main_sha === 'string' ? generated.main_sha : null,
          totalPackets,
          donePackets,
          inProgressPackets: Number(byStatus['in-progress']?.packets ?? 0) || 0,
          todoPackets: Number(byStatus.todo?.packets ?? 0) || 0,
          pctByPoints: Number(byStatus.done?.pct_by_points ?? 0) || 0,
          launchDone:
            byTrack.launch && Number.isFinite(Number(byTrack.launch.done))
              ? Number(byTrack.launch.done)
              : null,
          launchTotal:
            byTrack.launch && Number.isFinite(Number(byTrack.launch.total))
              ? Number(byTrack.launch.total)
              : null,
          readyCount: Number(summary.todo_with_dependencies_met ?? 0) || 0,
          readyLaunchCount: Number(summary.todo_with_dependencies_met_launch ?? 0) || 0,
          stalledCount: Number(summary.stalled_ready ?? 0) || 0,
        },
      };
    } catch {
      return {
        status: 'unavailable',
        source,
        fetchedAt,
        sourceTimestamp: null,
        data: null,
        reason: 'Status file could not be parsed',
      };
    }
  }

  private readBlockers(fetchedAt: string, nowMs: number): OpsSection<BlockersData> {
    const source = 'docs/reconstruction/handoff/ORCHESTRATOR-STATE.md';
    const fullPath = join(this.repoRoot, source);
    if (!existsSync(fullPath)) {
      return {
        status: 'unavailable',
        source,
        fetchedAt,
        sourceTimestamp: null,
        data: null,
        reason: 'Orchestrator state file not found',
      };
    }
    try {
      const md = readFileSync(fullPath, 'utf8');
      const sourceTimestamp = parseOrchestratorLastWritten(md);
      const items = extractBlockers(md);
      return {
        status: statusFromTimestamp(sourceTimestamp, nowMs, this.staleAfterMs),
        source,
        fetchedAt,
        sourceTimestamp,
        data: { items },
      };
    } catch {
      return {
        status: 'unavailable',
        source,
        fetchedAt,
        sourceTimestamp: null,
        data: null,
        reason: 'Orchestrator state file could not be read',
      };
    }
  }

  private async githubGetJson<T>(
    repo: string,
    token: string,
    path: string,
  ): Promise<{ ok: true; data: T } | { ok: false; reason: string }> {
    const url = `https://api.github.com/repos/${repo}${path}`;
    try {
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'keyflowos-ops-console',
          Authorization: `Bearer ${token}`,
        },
        signal: AbortSignal.timeout(GITHUB_TIMEOUT_MS),
      });
      if (!res.ok) {
        return { ok: false, reason: `GitHub API returned HTTP ${res.status}` };
      }
      const data = (await res.json()) as T;
      return { ok: true, data };
    } catch {
      // Never echo upstream error messages, which could include headers or URLs.
      return { ok: false, reason: 'GitHub API unreachable' };
    }
  }

  private async fetchLatestMain(
    gh: ReturnType<typeof resolveGithubConfig>,
    fetchedAt: string,
    nowMs: number,
  ): Promise<OpsSection<LatestMainData>> {
    const source = gh.repo ? `github:${gh.repo}:commits/main` : 'github:unconfigured';
    if (!gh.token) {
      return {
        status: 'unavailable',
        source,
        fetchedAt,
        sourceTimestamp: null,
        data: null,
        reason: 'GitHub credentials not configured on server',
      };
    }
    if (!gh.repo) {
      return {
        status: 'unavailable',
        source,
        fetchedAt,
        sourceTimestamp: null,
        data: null,
        reason: gh.repoError ?? 'Invalid GitHub repository configuration',
      };
    }

    const res = await this.githubGetJson<{
      sha?: string;
      html_url?: string;
      commit?: {
        message?: string;
        committer?: { name?: string; date?: string };
        author?: { name?: string; date?: string };
      };
    }>(gh.repo, gh.token, '/commits/main');

    if (!res.ok || typeof res.data?.sha !== 'string') {
      return {
        status: 'unavailable',
        source,
        fetchedAt,
        sourceTimestamp: null,
        data: null,
        reason: res.ok ? 'Malformed GitHub commit response' : res.reason,
      };
    }

    const committedAt =
      res.data.commit?.committer?.date ?? res.data.commit?.author?.date ?? null;
    if (!committedAt || parseTimestampMs(committedAt) === null) {
      return {
        status: 'unavailable',
        source,
        fetchedAt,
        sourceTimestamp: null,
        data: null,
        reason: 'GitHub commit response missing commit timestamp',
      };
    }

    const subject = String(res.data.commit?.message ?? '').split('\n')[0].trim().slice(0, 200);
    const author = String(
      res.data.commit?.committer?.name ?? res.data.commit?.author?.name ?? 'unknown',
    ).slice(0, 120);

    return {
      status: statusFromTimestamp(committedAt, nowMs, this.staleAfterMs),
      source,
      fetchedAt,
      sourceTimestamp: committedAt,
      data: {
        sha: res.data.sha,
        shortSha: res.data.sha.slice(0, 8),
        subject,
        author,
        committedAt,
        htmlUrl: typeof res.data.html_url === 'string' ? res.data.html_url : '',
      },
    };
  }

  private async fetchOpenPrs(
    gh: ReturnType<typeof resolveGithubConfig>,
    fetchedAt: string,
  ): Promise<OpsSection<OpenPrsData>> {
    const source = gh.repo ? `github:${gh.repo}:pulls` : 'github:unconfigured';
    if (!gh.token) {
      return {
        status: 'unavailable',
        source,
        fetchedAt,
        sourceTimestamp: null,
        data: null,
        reason: 'GitHub credentials not configured on server',
      };
    }
    if (!gh.repo) {
      return {
        status: 'unavailable',
        source,
        fetchedAt,
        sourceTimestamp: null,
        data: null,
        reason: gh.repoError ?? 'Invalid GitHub repository configuration',
      };
    }

    const pullsRes = await this.githubGetJson<
      Array<{
        number: number;
        title: string;
        draft?: boolean;
        updated_at: string;
        html_url: string;
        head?: { sha?: string; ref?: string };
      }>
    >(gh.repo, gh.token, '/pulls?state=open&sort=updated&direction=desc&per_page=20');

    if (!pullsRes.ok || !Array.isArray(pullsRes.data)) {
      return {
        status: 'unavailable',
        source,
        fetchedAt,
        sourceTimestamp: null,
        data: null,
        reason: pullsRes.ok ? 'Malformed GitHub pulls response' : pullsRes.reason,
      };
    }

    const items: OpenPrItem[] = await Promise.all(
      pullsRes.data.slice(0, 20).map(async (pr) => {
        const headSha = String(pr.head?.sha ?? '');
        let ciState: OpenPrItem['ciState'] = 'unknown';
        if (/^[0-9a-f]{7,40}$/i.test(headSha)) {
          const checksRes = await this.githubGetJson<{
            total_count?: number;
            check_runs?: Array<{ status?: string; conclusion?: string | null }>;
          }>(gh.repo!, gh.token!, `/commits/${headSha}/check-runs?per_page=100`);
          if (checksRes.ok && Array.isArray(checksRes.data?.check_runs)) {
            const runs = checksRes.data.check_runs;
            if (runs.length > 0) {
              if (runs.some((r) => r.conclusion && FAILING_CONCLUSIONS.has(r.conclusion))) {
                ciState = 'failing';
              } else if (runs.some((r) => r.status !== 'completed')) {
                ciState = 'pending';
              } else {
                ciState = 'passing';
              }
            }
          }
        }
        return {
          number: pr.number,
          title: String(pr.title ?? '').slice(0, 200),
          draft: Boolean(pr.draft),
          headRef: String(pr.head?.ref ?? '').slice(0, 120),
          headSha,
          updatedAt: String(pr.updated_at ?? ''),
          htmlUrl: String(pr.html_url ?? ''),
          ciState,
        };
      }),
    );

    const newestUpdated =
      items
        .map((i) => i.updatedAt)
        .filter((d) => parseTimestampMs(d) !== null)
        .sort()
        .at(-1) ?? fetchedAt;

    return {
      status: 'ok',
      source,
      fetchedAt,
      sourceTimestamp: newestUpdated,
      data: { items },
    };
  }

  private async fetchControlRoom(
    gh: ReturnType<typeof resolveGithubConfig>,
    fetchedAt: string,
  ): Promise<OpsSection<ControlRoomData>> {
    const source = gh.repo
      ? `github:${gh.repo}:issues/${gh.issueNumber}/comments`
      : 'github:unconfigured';
    if (!gh.token) {
      return {
        status: 'unavailable',
        source,
        fetchedAt,
        sourceTimestamp: null,
        data: null,
        reason: 'GitHub credentials not configured on server',
      };
    }
    if (!gh.repo) {
      return {
        status: 'unavailable',
        source,
        fetchedAt,
        sourceTimestamp: null,
        data: null,
        reason: gh.repoError ?? 'Invalid GitHub repository configuration',
      };
    }

    const res = await this.githubGetJson<
      Array<{
        id: number;
        created_at: string;
        html_url: string;
        user?: { login?: string };
        body?: string;
      }>
    >(gh.repo, gh.token, `/issues/${gh.issueNumber}/comments?sort=created&direction=desc&per_page=10`);

    if (!res.ok || !Array.isArray(res.data)) {
      return {
        status: 'unavailable',
        source,
        fetchedAt,
        sourceTimestamp: null,
        data: null,
        reason: res.ok ? 'Malformed GitHub comments response' : res.reason,
      };
    }

    const items: ControlRoomComment[] = res.data.slice(0, 10).map((c) => ({
      id: c.id,
      author: String(c.user?.login ?? 'unknown').slice(0, 80),
      createdAt: String(c.created_at ?? ''),
      excerpt: String(c.body ?? '').split('\n')[0].trim().slice(0, 240),
      htmlUrl: String(c.html_url ?? ''),
    }));

    const newestCreated =
      items
        .map((i) => i.createdAt)
        .filter((d) => parseTimestampMs(d) !== null)
        .sort()
        .at(-1) ?? fetchedAt;

    return {
      status: 'ok',
      source,
      fetchedAt,
      sourceTimestamp: newestCreated,
      data: { issueNumber: gh.issueNumber, items },
    };
  }
}
