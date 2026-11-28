import { Inject, Injectable, Optional } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
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
  inProgressPackets: number | null;
  todoPackets: number | null;
  pctByPoints: number | null;
  launchDone: number | null;
  launchTotal: number | null;
  readyCount: number | null;
  readyLaunchCount: number | null;
  stalledCount: number | null;
  uncertainCount: number | null;
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
  cacheTtlMs?: number;
}

const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CACHE_TTL_MS = 20_000;
const GITHUB_TIMEOUT_MS = 5_000;
const MAX_LOCAL_FILE_BYTES = 2 * 1024 * 1024;
const CHECK_RUNS_CONCURRENCY = 5;
const CONTROL_ROOM_LIMIT = 10;
const DEFAULT_CONTROL_ROOM_ISSUE = 273;
const DEFAULT_GITHUB_REPO = 'KEYFLOWOS/KEYFLOWOS';

const SAFE_GITHUB_OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const SAFE_GITHUB_REPO_RE = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,100}$/;

const FAILING_CONCLUSIONS = new Set([
  'failure',
  'timed_out',
  'cancelled',
  'action_required',
  'startup_failure',
]);
const BENIGN_NON_PASS_CONCLUSIONS = new Set(['skipped', 'neutral']);

function isSafeGithubSlug(raw: string): boolean {
  const parts = raw.split('/');
  if (parts.length !== 2) return false;
  return SAFE_GITHUB_OWNER_RE.test(parts[0]) && SAFE_GITHUB_REPO_RE.test(parts[1]);
}

function safeGithubHtmlUrl(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return '';
  try {
    const parsed = new URL(raw.trim());
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function finiteNumberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function discoverRepoRoot(startDir: string): string {
  let cur = resolve(startDir);
  for (let i = 0; i < 6; i += 1) {
    if (
      existsSync(join(cur, 'docs', 'reconstruction', 'handoff', 'V1-STATUS.json')) ||
      existsSync(join(cur, 'docs', 'reconstruction', 'handoff', 'ORCHESTRATOR-STATE.md')) ||
      existsSync(join(cur, 'pnpm-workspace.yaml'))
    ) {
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

function newestTimestamp(dates: Array<string | null | undefined>, fallback: string): string {
  let best: string | null = null;
  let bestMs = -Infinity;
  for (const d of dates) {
    const ms = parseTimestampMs(d);
    if (ms !== null && ms > bestMs) {
      bestMs = ms;
      best = d!;
    }
  }
  return best ?? fallback;
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

function firstNonEmptyLine(body: unknown, maxLen: number): string {
  const lines = String(body ?? '').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) return trimmed.slice(0, maxLen);
  }
  return '';
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
      inSection = /open\s+(?:owner\s+)?questions|blockers/i.test(headingMatch[1]);
      continue;
    }
    if (!inSection) continue;
    const trimmed = rawLine.trim();
    if (!trimmed) continue;
    const numberedMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numberedMatch) {
      items.push(numberedMatch[1].trim().slice(0, 240));
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      items.push(trimmed.slice(2).trim().slice(0, 240));
    } else if (
      trimmed.startsWith('|') &&
      !/^\|[\s|:-]+\|$/.test(trimmed) &&
      !/^\|\s*(#|id|question|item)\s*\|/i.test(trimmed)
    ) {
      items.push(trimmed.slice(0, 240));
    }
    if (items.length >= 30) break;
  }
  return items;
}

function computeCiState(
  runs: Array<{ status?: string; conclusion?: string | null }>,
  totalCount?: number,
): OpenPrItem['ciState'] {
  if (runs.length === 0) return 'unknown';
  if (runs.some((r) => typeof r.conclusion === 'string' && FAILING_CONCLUSIONS.has(r.conclusion))) {
    return 'failing';
  }
  if (runs.some((r) => r.status !== 'completed')) {
    return 'pending';
  }
  if (typeof totalCount === 'number' && totalCount > runs.length) {
    return 'unknown';
  }
  let sawSuccess = false;
  for (const r of runs) {
    if (r.conclusion === 'success') {
      sawSuccess = true;
    } else if (typeof r.conclusion === 'string' && BENIGN_NON_PASS_CONCLUSIONS.has(r.conclusion)) {
      continue;
    } else {
      return 'unknown';
    }
  }
  return sawSuccess ? 'passing' : 'unknown';
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIdx = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIdx < items.length) {
        const idx = nextIdx;
        nextIdx += 1;
        results[idx] = await fn(items[idx]);
      }
    }),
  );
  return results;
}

function resolveGithubConfig(): {
  token: string | null;
  repo: string | null;
  issueNumber: number;
  repoError?: string;
} {
  const rawIssueStr = process.env.OPS_CONSOLE_CONTROL_ROOM_ISSUE;
  const parsedIssue = rawIssueStr !== undefined && /^\d+$/.test(rawIssueStr.trim())
    ? Number(rawIssueStr.trim())
    : DEFAULT_CONTROL_ROOM_ISSUE;
  const issueNumber =
    Number.isSafeInteger(parsedIssue) && parsedIssue > 0 ? parsedIssue : DEFAULT_CONTROL_ROOM_ISSUE;
  const token =
    (process.env.OPS_CONSOLE_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '').trim() || null;
  const rawRepo = (process.env.OPS_CONSOLE_GITHUB_REPO || DEFAULT_GITHUB_REPO).trim();
  if (!isSafeGithubSlug(rawRepo)) {
    return { token, repo: null, issueNumber, repoError: 'Invalid GitHub repository configuration' };
  }
  return { token, repo: rawRepo, issueNumber };
}

interface GithubCommentPayload {
  id: number;
  created_at: string;
  html_url: string;
  user?: { login?: string };
  body?: string;
}

@Injectable()
export class AdminOpsConsoleService {
  private readonly repoRoot: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly staleAfterMs: number;
  private readonly cacheTtlMs: number;
  private cached: { key: string; expiresAtMs: number; snapshot: OpsConsoleSnapshot } | null = null;
  private inFlight: { key: string; promise: Promise<OpsConsoleSnapshot> } | null = null;

  constructor(
    @Optional() @Inject(OPS_CONSOLE_OPTIONS) options?: AdminOpsConsoleOptions,
  ) {
    this.repoRoot = options?.repoRoot ?? discoverRepoRoot(process.cwd());
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.now = options?.now ?? (() => new Date());
    this.staleAfterMs = options?.staleAfterMs ?? DEFAULT_STALE_MS;
    this.cacheTtlMs = options?.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  async getSnapshot(): Promise<OpsConsoleSnapshot> {
    const nowDate = this.now();
    const nowMs = nowDate.getTime();
    const gh = resolveGithubConfig();
    const cacheKey = `${gh.repo ?? 'invalid'}|${gh.issueNumber}|${gh.token ? '1' : '0'}`;

    if (
      this.cacheTtlMs > 0 &&
      this.cached &&
      this.cached.key === cacheKey &&
      nowMs < this.cached.expiresAtMs
    ) {
      return this.cached.snapshot;
    }
    if (this.inFlight && this.inFlight.key === cacheKey) {
      return this.inFlight.promise;
    }

    const promise = this.buildSnapshot(gh, nowDate, nowMs).then((snapshot) => {
      if (this.cacheTtlMs > 0) {
        this.cached = { key: cacheKey, expiresAtMs: nowMs + this.cacheTtlMs, snapshot };
      }
      return snapshot;
    });

    this.inFlight = { key: cacheKey, promise };
    try {
      return await promise;
    } finally {
      if (this.inFlight?.promise === promise) {
        this.inFlight = null;
      }
    }
  }

  private async buildSnapshot(
    gh: ReturnType<typeof resolveGithubConfig>,
    nowDate: Date,
    nowMs: number,
  ): Promise<OpsConsoleSnapshot> {
    const fetchedAt = nowDate.toISOString();

    const [v1Progress, blockers, latestMain, openPrs, controlRoom] = await Promise.all([
      this.readV1Progress(fetchedAt, nowMs),
      this.readBlockers(fetchedAt, nowMs),
      this.fetchLatestMain(gh, fetchedAt),
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

  private async readBoundedTextFile(fullPath: string): Promise<{ ok: true; text: string } | { ok: false; reason: string }> {
    try {
      const info = await stat(fullPath);
      if (!info.isFile()) {
        return { ok: false, reason: 'Target is not a regular file' };
      }
      if (info.size > MAX_LOCAL_FILE_BYTES) {
        return { ok: false, reason: 'Source file exceeds size limit' };
      }
      const text = await readFile(fullPath, 'utf8');
      return { ok: true, text };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') return { ok: false, reason: 'Source file not found' };
      return { ok: false, reason: 'Source file could not be read' };
    }
  }

  private async readV1Progress(fetchedAt: string, nowMs: number): Promise<OpsSection<V1ProgressData>> {
    const source = 'docs/reconstruction/handoff/V1-STATUS.json';
    const fullPath = join(this.repoRoot, source);
    const fileRes = await this.readBoundedTextFile(fullPath);
    if (!fileRes.ok) {
      return {
        status: 'unavailable',
        source,
        fetchedAt,
        sourceTimestamp: null,
        data: null,
        reason: fileRes.reason,
      };
    }
    try {
      const parsed = JSON.parse(fileRes.text) as Record<string, unknown>;
      const generated = (parsed._generated ?? {}) as Record<string, unknown>;
      const summary = (parsed.summary ?? {}) as Record<string, unknown>;
      const byStatus = (summary.by_status ?? {}) as Record<string, Record<string, unknown>>;
      const byTrack = (summary.by_track ?? {}) as Record<string, Record<string, unknown>>;

      const sourceTimestamp =
        typeof generated.main_commit_date === 'string' && parseTimestampMs(generated.main_commit_date) !== null
          ? generated.main_commit_date
          : null;
      const totalPackets = finiteNumberOrNull(summary.packets);
      const donePackets = finiteNumberOrNull(byStatus.done?.packets);
      if (totalPackets === null || donePackets === null) {
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
          inProgressPackets: finiteNumberOrNull(byStatus['in-progress']?.packets),
          todoPackets: finiteNumberOrNull(byStatus.todo?.packets),
          pctByPoints: finiteNumberOrNull(byStatus.done?.pct_by_points),
          launchDone: finiteNumberOrNull(byTrack.launch?.done),
          launchTotal: finiteNumberOrNull(byTrack.launch?.total),
          readyCount: finiteNumberOrNull(summary.todo_with_dependencies_met),
          readyLaunchCount: finiteNumberOrNull(summary.todo_with_dependencies_met_launch),
          stalledCount: finiteNumberOrNull(summary.stalled_ready),
          uncertainCount: Array.isArray(summary.uncertain) ? summary.uncertain.length : null,
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

  private async readBlockers(fetchedAt: string, nowMs: number): Promise<OpsSection<BlockersData>> {
    const source = 'docs/reconstruction/handoff/ORCHESTRATOR-STATE.md';
    const fullPath = join(this.repoRoot, source);
    const fileRes = await this.readBoundedTextFile(fullPath);
    if (!fileRes.ok) {
      return {
        status: 'unavailable',
        source,
        fetchedAt,
        sourceTimestamp: null,
        data: null,
        reason: fileRes.reason,
      };
    }
    const sourceTimestamp = parseOrchestratorLastWritten(fileRes.text);
    const items = extractBlockers(fileRes.text);
    return {
      status: statusFromTimestamp(sourceTimestamp, nowMs, this.staleAfterMs),
      source,
      fetchedAt,
      sourceTimestamp,
      data: { items },
    };
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
        redirect: 'error',
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

    const subject = firstNonEmptyLine(res.data.commit?.message, 200);
    const author = String(
      res.data.commit?.committer?.name ?? res.data.commit?.author?.name ?? 'unknown',
    ).slice(0, 120);

    return {
      status: 'ok',
      source,
      fetchedAt,
      sourceTimestamp: committedAt,
      data: {
        sha: res.data.sha,
        shortSha: res.data.sha.slice(0, 8),
        subject,
        author,
        committedAt,
        htmlUrl: safeGithubHtmlUrl(res.data.html_url),
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

    const items: OpenPrItem[] = await mapWithConcurrency(
      pullsRes.data.slice(0, 20),
      CHECK_RUNS_CONCURRENCY,
      async (pr) => {
        const headSha = String(pr.head?.sha ?? '');
        let ciState: OpenPrItem['ciState'] = 'unknown';
        if (/^[0-9a-f]{7,40}$/i.test(headSha)) {
          const checksRes = await this.githubGetJson<{
            total_count?: number;
            check_runs?: Array<{ status?: string; conclusion?: string | null }>;
          }>(gh.repo!, gh.token!, `/commits/${headSha}/check-runs?per_page=100`);
          if (checksRes.ok && Array.isArray(checksRes.data?.check_runs)) {
            ciState = computeCiState(checksRes.data.check_runs, checksRes.data.total_count);
          }
        }
        return {
          number: pr.number,
          title: String(pr.title ?? '').slice(0, 200),
          draft: Boolean(pr.draft),
          headRef: String(pr.head?.ref ?? '').slice(0, 120),
          headSha,
          updatedAt: String(pr.updated_at ?? ''),
          htmlUrl: safeGithubHtmlUrl(pr.html_url),
          ciState,
        };
      },
    );

    return {
      status: 'ok',
      source,
      fetchedAt,
      sourceTimestamp: newestTimestamp(
        items.map((i) => i.updatedAt),
        fetchedAt,
      ),
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

    // GitHub's /issues/{n}/comments endpoint ignores sort/direction and always returns ascending
    // pages starting from the oldest comment. Read the issue's total comment count first and
    // fetch the tail page(s) to retrieve the newest comments accurately.
    const issueRes = await this.githubGetJson<{ comments?: number }>(
      gh.repo,
      gh.token,
      `/issues/${gh.issueNumber}`,
    );
    if (!issueRes.ok || typeof issueRes.data?.comments !== 'number' || !Number.isFinite(issueRes.data.comments)) {
      return {
        status: 'unavailable',
        source,
        fetchedAt,
        sourceTimestamp: null,
        data: null,
        reason: issueRes.ok ? 'Malformed GitHub issue response' : issueRes.reason,
      };
    }

    const totalComments = Math.max(0, Math.floor(issueRes.data.comments));
    if (totalComments === 0) {
      return {
        status: 'ok',
        source,
        fetchedAt,
        sourceTimestamp: fetchedAt,
        data: { issueNumber: gh.issueNumber, items: [] },
      };
    }

    const lastPage = Math.ceil(totalComments / CONTROL_ROOM_LIMIT);
    const tailRes = await this.githubGetJson<GithubCommentPayload[]>(
      gh.repo,
      gh.token,
      `/issues/${gh.issueNumber}/comments?per_page=${CONTROL_ROOM_LIMIT}&page=${lastPage}`,
    );
    if (!tailRes.ok || !Array.isArray(tailRes.data)) {
      return {
        status: 'unavailable',
        source,
        fetchedAt,
        sourceTimestamp: null,
        data: null,
        reason: tailRes.ok ? 'Malformed GitHub comments response' : tailRes.reason,
      };
    }

    let combined: GithubCommentPayload[] = tailRes.data;
    if (combined.length < CONTROL_ROOM_LIMIT && lastPage > 1) {
      const prevRes = await this.githubGetJson<GithubCommentPayload[]>(
        gh.repo,
        gh.token,
        `/issues/${gh.issueNumber}/comments?per_page=${CONTROL_ROOM_LIMIT}&page=${lastPage - 1}`,
      );
      if (prevRes.ok && Array.isArray(prevRes.data)) {
        combined = [...prevRes.data, ...combined];
      }
    }

    const newest = combined.slice(-CONTROL_ROOM_LIMIT).reverse();
    const items: ControlRoomComment[] = newest.map((c) => ({
      id: c.id,
      author: String(c.user?.login ?? 'unknown').slice(0, 80),
      createdAt: String(c.created_at ?? ''),
      excerpt: firstNonEmptyLine(c.body, 240),
      htmlUrl: safeGithubHtmlUrl(c.html_url),
    }));

    return {
      status: 'ok',
      source,
      fetchedAt,
      sourceTimestamp: newestTimestamp(
        items.map((i) => i.createdAt),
        fetchedAt,
      ),
      data: { issueNumber: gh.issueNumber, items },
    };
  }
}
