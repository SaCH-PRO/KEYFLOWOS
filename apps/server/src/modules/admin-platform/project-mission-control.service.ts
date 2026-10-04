import { Injectable } from '@nestjs/common';

export type MissionControlHealth = 'GREEN' | 'YELLOW' | 'RED' | 'STALE' | 'UNKNOWN';
export type EvidenceStatus = 'PASS' | 'FAIL' | 'PENDING' | 'SKIPPED' | 'UNKNOWN';

export interface MissionControlCheck {
  name: string;
  status: EvidenceStatus;
}

export interface MissionControlProgress {
  completed: number | null;
  total: number | null;
  basis: string;
}

export interface MissionControlPullRequest {
  number: number;
  title: string;
  headSha: string | null;
  branch: string | null;
  draft: boolean | null;
  mergeable: boolean | null;
  mergeableState: string | null;
  updatedAt: string | null;
  checks: MissionControlCheck[];
  proof: MissionControlProgress;
  health: MissionControlHealth;
}

export interface MissionControlWorkstream {
  id: string;
  label: string;
  issue: number | null;
  pullRequest: number | null;
  phase: string;
  status: string;
  progress: MissionControlProgress;
  nextLegalAction: string;
}

export interface ProjectMissionControlSnapshot {
  generatedAt: string;
  repository: string;
  sourceMain: string | null;
  freshness: {
    status: 'LIVE' | 'DEGRADED';
    github: 'AVAILABLE' | 'UNAVAILABLE';
    detail: string | null;
  };
  health: MissionControlHealth;
  workstreams: MissionControlWorkstream[];
  pullRequests: MissionControlPullRequest[];
  blockers: Array<{ source: string; detail: string }>;
  workers: Array<{
    id: string;
    kind: 'CHATGPT' | 'CLAUDE' | 'KIMI' | 'AUTOMATION' | 'KEY' | 'OTHER';
    state: string;
    packetId: string | null;
    branch: string | null;
    lastHeartbeatAt: string | null;
  }>;
}

type GitHubCheckRun = {
  name?: string;
  status?: string;
  conclusion?: string | null;
};

type GitHubPullRequest = {
  number: number;
  title?: string;
  draft?: boolean;
  mergeable?: boolean | null;
  mergeable_state?: string | null;
  updated_at?: string | null;
  head?: { sha?: string; ref?: string };
};

const TRACKED = Object.freeze([
  {
    id: 'control-plane',
    label: 'Autonomous Development Control Plane',
    issue: 119,
    pullRequest: 120,
    phase: 'PROVE / REVIEW',
    status: 'ACTIVE',
    nextLegalAction: 'Finish exact-head proof, final control artifact, review, and RETURN. No merge without admission.',
  },
  {
    id: 'memory',
    label: 'Memory / Context Genome',
    issue: 122,
    pullRequest: 127,
    phase: 'M0 TRUTH AUDIT',
    status: 'SEQUENCED',
    nextLegalAction: 'Close M0 proof gaps before M1 canonical persistence contracts.',
  },
  {
    id: 'key-cognition',
    label: 'KEY Cognitive Architecture',
    issue: null,
    pullRequest: 128,
    phase: 'CONVERGENCE',
    status: 'ACTIVE',
    nextLegalAction: 'Converge duplicated runtimes and map K1-K7 ownership before production refactor.',
  },
  {
    id: 'verification-security',
    label: 'Verification / Security / No-Fake-Green',
    issue: 113,
    pullRequest: 114,
    phase: 'PROOF INTEGRITY',
    status: 'BLOCKED',
    nextLegalAction: 'Reconcile proof-integrity work with current main while preserving fail-closed semantics.',
  },
  {
    id: 'connector-fabric',
    label: 'Connector / World Interface Fabric',
    issue: null,
    pullRequest: 105,
    phase: 'ARCHITECTURE RECONCILIATION',
    status: 'QUEUED',
    nextLegalAction: 'Reconcile historical connector architecture with live main and K2/K6 contracts.',
  },
  {
    id: 'mission-control',
    label: 'Mission Control',
    issue: 129,
    pullRequest: null,
    phase: 'PHASE A',
    status: 'IMPLEMENTING',
    nextLegalAction: 'Ship a read-only, exact-evidence admin snapshot before adding mutations.',
  },
  {
    id: 'assurance',
    label: 'Continuous Assurance Fabric',
    issue: 130,
    pullRequest: null,
    phase: 'MAP / CONTRACT',
    status: 'QUEUED',
    nextLegalAction: 'Inventory live proof/security/observability before adding new runners.',
  },
  {
    id: 'learning-stream',
    label: 'Continuous Learning Stream',
    issue: 131,
    pullRequest: null,
    phase: 'MAP / CONTRACT',
    status: 'QUEUED',
    nextLegalAction: 'Reuse dormant knowledge ingestion; shadow provenance before canonical memory writes.',
  },
]);

export function normalizeCheck(run: GitHubCheckRun): MissionControlCheck {
  if (run.status !== 'completed') return { name: run.name ?? 'unnamed check', status: 'PENDING' };
  switch (run.conclusion) {
    case 'success':
      return { name: run.name ?? 'unnamed check', status: 'PASS' };
    case 'failure':
    case 'cancelled':
    case 'timed_out':
    case 'action_required':
    case 'stale':
    case 'startup_failure':
      return { name: run.name ?? 'unnamed check', status: 'FAIL' };
    case 'skipped':
      return { name: run.name ?? 'unnamed check', status: 'SKIPPED' };
    case 'neutral':
      return { name: run.name ?? 'unnamed check', status: 'UNKNOWN' };
    default:
      return { name: run.name ?? 'unnamed check', status: 'UNKNOWN' };
  }
}

export function proofProgress(checks: MissionControlCheck[]): MissionControlProgress {
  // Deduplicate reruns by check name. The latest GitHub item for a name wins because
  // the API returns newest runs first. This avoids fake progress from counting a
  // stale and current run as two independent proofs.
  const latest = new Map<string, MissionControlCheck>();
  for (const check of checks) if (!latest.has(check.name)) latest.set(check.name, check);
  const relevant = [...latest.values()].filter((c) => c.status !== 'SKIPPED');
  if (relevant.length === 0) {
    return { completed: null, total: null, basis: 'No non-skipped check evidence available.' };
  }
  return {
    completed: relevant.filter((c) => c.status === 'PASS').length,
    total: relevant.length,
    basis: 'Latest non-skipped GitHub check result per check name at the current PR head.',
  };
}

function healthFromChecks(checks: MissionControlCheck[]): MissionControlHealth {
  if (checks.some((c) => c.status === 'FAIL')) return 'RED';
  if (checks.some((c) => c.status === 'PENDING' || c.status === 'UNKNOWN')) return 'YELLOW';
  if (checks.some((c) => c.status === 'PASS')) return 'GREEN';
  return 'UNKNOWN';
}

export function aggregateProgrammeHealth(
  pullRequests: Array<Pick<MissionControlPullRequest, 'health'>>,
): MissionControlHealth {
  if (pullRequests.some((p) => p.health === 'RED')) return 'RED';
  if (pullRequests.some((p) => p.health === 'YELLOW')) return 'YELLOW';
  if (pullRequests.length > 0 && pullRequests.every((p) => p.health === 'GREEN')) return 'GREEN';
  return 'UNKNOWN';
}

const SNAPSHOT_TTL_MS = 30_000;
let cached: { at: number; value: ProjectMissionControlSnapshot } | null = null;
let inFlight: Promise<ProjectMissionControlSnapshot> | null = null;

@Injectable()
export class ProjectMissionControlService {
  private readonly repository = process.env.KEYFLOW_MISSION_CONTROL_REPO || 'SaCH-PRO/KEYFLOWOS';
  private readonly token = process.env.KEYFLOW_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';

  async snapshot(): Promise<ProjectMissionControlSnapshot> {
    const now = Date.now();
    if (cached && now - cached.at < SNAPSHOT_TTL_MS) return cached.value;
    if (inFlight) return inFlight;

    inFlight = this.buildSnapshot();
    try {
      const value = await inFlight;
      cached = { at: Date.now(), value };
      return value;
    } finally {
      inFlight = null;
    }
  }

  private async buildSnapshot(): Promise<ProjectMissionControlSnapshot> {
    const generatedAt = new Date().toISOString();
    const blockers: ProjectMissionControlSnapshot['blockers'] = [];

    if (!this.token) {
      return {
        generatedAt,
        repository: this.repository,
        sourceMain: null,
        freshness: {
          status: 'DEGRADED',
          github: 'UNAVAILABLE',
          detail: 'KEYFLOW_GITHUB_TOKEN or GITHUB_TOKEN is required for live Mission Control evidence.',
        },
        health: 'UNKNOWN',
        workstreams: TRACKED.map((stream) => ({
          ...stream,
          progress: {
            completed: null,
            total: null,
            basis: 'Authenticated live GitHub evidence unavailable; progress intentionally unknown.',
          },
        })),
        pullRequests: [],
        blockers: [{ source: 'mission-control', detail: 'Authenticated GitHub evidence is not configured; no green state is inferred.' }],
        workers: [],
      };
    }

    try {
      const main = await this.github<{ commit?: { sha?: string } }>(`/branches/main`);
      const sourceMain = main.commit?.sha ?? null;
      const pullRequests = await Promise.all(
        TRACKED.filter((x) => x.pullRequest !== null).map((x) => this.pullRequestSnapshot(x.pullRequest as number)),
      );

      for (const pr of pullRequests) {
        if (pr.health === 'RED') blockers.push({ source: `PR #${pr.number}`, detail: 'One or more current-head checks are failing.' });
      }

      const byPr = new Map(pullRequests.map((pr) => [pr.number, pr]));
      const workstreams = TRACKED.map((stream) => {
        const pr = stream.pullRequest ? byPr.get(stream.pullRequest) : undefined;
        return {
          ...stream,
          progress: pr?.proof ?? {
            completed: null,
            total: null,
            basis: 'No evidence-backed denominator is defined for this workstream yet.',
          },
        };
      });

      const health = aggregateProgrammeHealth(pullRequests);

      return {
        generatedAt,
        repository: this.repository,
        sourceMain,
        freshness: { status: 'LIVE', github: 'AVAILABLE', detail: null },
        health,
        workstreams,
        pullRequests,
        blockers,
        // Worker/session heartbeats require packet-scoped control-plane state.
        // Do not fabricate them from issue comments.
        workers: [],
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        generatedAt,
        repository: this.repository,
        sourceMain: null,
        freshness: { status: 'DEGRADED', github: 'UNAVAILABLE', detail },
        health: 'UNKNOWN',
        workstreams: TRACKED.map((stream) => ({
          ...stream,
          progress: {
            completed: null,
            total: null,
            basis: 'Live GitHub evidence unavailable; progress intentionally unknown.',
          },
        })),
        pullRequests: [],
        blockers: [{ source: 'mission-control', detail: 'Live GitHub evidence is unavailable; no green state is inferred.' }],
        workers: [],
      };
    }
  }

  private async pullRequestSnapshot(number: number): Promise<MissionControlPullRequest> {
    const pr = await this.github<GitHubPullRequest>(`/pulls/${number}`);
    const headSha = pr.head?.sha ?? null;
    let checks: MissionControlCheck[] = [];
    if (headSha) {
      const response = await this.github<{ check_runs?: GitHubCheckRun[] }>(`/commits/${headSha}/check-runs?per_page=100`);
      checks = (response.check_runs ?? []).map(normalizeCheck);
    }
    return {
      number,
      title: pr.title ?? `PR #${number}`,
      headSha,
      branch: pr.head?.ref ?? null,
      draft: pr.draft ?? null,
      mergeable: pr.mergeable ?? null,
      mergeableState: pr.mergeable_state ?? null,
      updatedAt: pr.updated_at ?? null,
      checks,
      proof: proofProgress(checks),
      health: healthFromChecks(checks),
    };
  }

  private async github<T>(path: string): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'keyflowos-mission-control',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;

    const response = await fetch(`https://api.github.com/repos/${this.repository}${path}`, {
      headers,
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new Error(`GitHub ${response.status} for ${path}`);
    }
    return response.json() as Promise<T>;
  }
}
