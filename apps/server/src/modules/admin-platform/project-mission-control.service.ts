import { Injectable } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';

export type MissionControlHealth = 'GREEN' | 'YELLOW' | 'RED' | 'STALE' | 'UNKNOWN';
export type EvidenceStatus = 'PASS' | 'FAIL' | 'PENDING' | 'SKIPPED' | 'UNKNOWN';
export type AtlasFreshness = 'FRESH' | 'STALE' | 'CONTRADICTED' | 'UNKNOWN';

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

export interface AtlasContradictionSummary {
  id: string;
  subject: string;
  disposition: string;
  detail: string;
}

export interface AtlasMissionControlProjection {
  status: AtlasFreshness;
  schema: string | null;
  verifiedAt: string | null;
  sourceRef: string | null;
  journeyCount: {
    named: number | null;
    claimed: number | null;
    status: 'CONSISTENT' | 'CONTRADICTED' | 'UNKNOWN';
  };
  kernelCount: {
    named: number | null;
    claimed: number | null;
    status: 'CONSISTENT' | 'CONTRADICTED' | 'UNKNOWN';
  };
  graph: {
    nodes: number | null;
    edges: number | null;
    packetSemanticStatus: string | null;
    packetSemanticPackets: number | null;
    verifiedCodeLinks: number | null;
  };
  layers: Array<{
    id: string;
    label: string;
    status: 'MAPPED' | 'PARTIAL' | 'UNVERIFIED' | 'CONTRADICTED';
    progress: MissionControlProgress;
  }>;
  contradictions: AtlasContradictionSummary[];
  missingArtifacts: string[];
}

export interface MissionControlWorkstream {
  id: string;
  label: string;
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
    atlas: AtlasFreshness;
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
  atlas: AtlasMissionControlProjection;
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

type IntelligenceTopology = {
  schema?: string;
  verified_at?: string;
  source_ref?: string;
  status?: string;
  claims?: {
    analysis_map_journeys?: number;
    current_state_journeys?: number;
    analysis_map_kernels?: number;
    current_state_kernels?: number;
  };
  journeys?: unknown[];
  kernels?: unknown[];
  contradictions?: Array<Record<string, unknown>>;
};

type AtlasGraph = {
  schema?: string;
  nodes?: unknown[];
  edges?: unknown[];
  source_state?: {
    packet_semantic_status?: string;
    packet_semantic_packets?: number;
    verified_code_links?: number;
  };
};

const ATLAS_FILES = Object.freeze({
  intelligence: 'architecture/atlas/generated/intelligence-topology.json',
  graph: 'architecture/atlas/generated/atlas-graph.json',
  packetSemantics: 'architecture/atlas/generated/packet-semantic-index.json',
  codeLinks: 'architecture/atlas/generated/packet-code-links.json',
});

const ATLAS_LAYER_LABELS = Object.freeze([
  ['L0', 'Reality / outcomes'],
  ['L1', 'Product / capabilities'],
  ['L2', 'Journeys'],
  ['L3', 'Kernels'],
  ['L4', 'KEY cognition'],
  ['L5', 'Execution'],
  ['L6', 'Implementation'],
  ['L7', 'Development system'],
  ['L8', 'Evidence / continuity'],
] as const);

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
  const latest = new Map<string, MissionControlCheck>();
  for (const check of checks) if (!latest.has(check.name)) latest.set(check.name, check);
  const relevant = [...latest.values()].filter((check) => check.status !== 'SKIPPED');
  if (relevant.length === 0) {
    return { completed: null, total: null, basis: 'No non-skipped exact-head check evidence available.' };
  }
  return {
    completed: relevant.filter((check) => check.status === 'PASS').length,
    total: relevant.length,
    basis: 'Latest non-skipped GitHub check result per check name at the current PR head.',
  };
}

function healthFromChecks(checks: MissionControlCheck[]): MissionControlHealth {
  if (checks.some((check) => check.status === 'FAIL')) return 'RED';
  if (checks.some((check) => check.status === 'PENDING' || check.status === 'UNKNOWN')) return 'YELLOW';
  if (checks.some((check) => check.status === 'PASS')) return 'GREEN';
  return 'UNKNOWN';
}

export function aggregateProgrammeHealth(
  pullRequests: Array<Pick<MissionControlPullRequest, 'health'>>,
  atlasStatus: AtlasFreshness,
): MissionControlHealth {
  if (pullRequests.some((pullRequest) => pullRequest.health === 'RED')) return 'RED';
  if (atlasStatus === 'CONTRADICTED') return 'YELLOW';
  if (pullRequests.some((pullRequest) => pullRequest.health === 'YELLOW')) return 'YELLOW';
  if (atlasStatus === 'STALE') return 'STALE';
  if (
    pullRequests.length > 0 &&
    pullRequests.every((pullRequest) => pullRequest.health === 'GREEN') &&
    atlasStatus === 'FRESH'
  ) {
    return 'GREEN';
  }
  return 'UNKNOWN';
}

function readJson<T>(root: string, relativePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8')) as T;
  } catch {
    return null;
  }
}

export function findRepositoryRoot(): string | null {
  const candidates = [
    process.env.KEYFLOW_REPOSITORY_ROOT,
    process.cwd(),
    path.resolve(process.cwd(), '../..'),
    path.resolve(__dirname, '../../../../..'),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, 'architecture')) &&
      fs.existsSync(path.join(candidate, 'apps/server'))
    ) {
      return candidate;
    }
  }
  return null;
}

function countStatus(named: number | null, claimed: number | null) {
  if (named === null || claimed === null) return 'UNKNOWN' as const;
  return named === claimed ? ('CONSISTENT' as const) : ('CONTRADICTED' as const);
}

function contradictionSummary(item: Record<string, unknown>): AtlasContradictionSummary {
  const id = String(item.id ?? 'UNNAMED_CONTRADICTION');
  const subject = String(item.subject ?? item.type ?? 'unknown');
  const disposition = String(item.disposition ?? 'UNRESOLVED');
  const parts: string[] = [];
  if (item.analysis_map_value !== undefined) parts.push(`analysis=${String(item.analysis_map_value)}`);
  if (item.current_state_value !== undefined) parts.push(`state=${String(item.current_state_value)}`);
  if (item.reference !== undefined) parts.push(`reference=${String(item.reference)}`);
  if (item.path !== undefined) parts.push(`path=${String(item.path)}`);
  return { id, subject, disposition, detail: parts.join(' · ') || 'See Atlas evidence.' };
}

export function buildAtlasProjection(
  root: string | null,
  now = new Date(),
): AtlasMissionControlProjection {
  const missingArtifacts: string[] = [];
  if (!root) {
    return {
      status: 'UNKNOWN',
      schema: null,
      verifiedAt: null,
      sourceRef: null,
      journeyCount: { named: null, claimed: null, status: 'UNKNOWN' },
      kernelCount: { named: null, claimed: null, status: 'UNKNOWN' },
      graph: {
        nodes: null,
        edges: null,
        packetSemanticStatus: null,
        packetSemanticPackets: null,
        verifiedCodeLinks: null,
      },
      layers: ATLAS_LAYER_LABELS.map(([id, label]) => ({
        id,
        label,
        status: 'UNVERIFIED',
        progress: { completed: null, total: null, basis: 'Repository root unavailable.' },
      })),
      contradictions: [],
      missingArtifacts: Object.values(ATLAS_FILES),
    };
  }

  const intelligence = readJson<IntelligenceTopology>(root, ATLAS_FILES.intelligence);
  const graph = readJson<AtlasGraph>(root, ATLAS_FILES.graph);
  const packetSemantics = readJson<{ status?: string; packets?: unknown[]; contradictions?: Array<Record<string, unknown>> }>(
    root,
    ATLAS_FILES.packetSemantics,
  );
  const codeLinks = readJson<{ status?: string; links?: unknown[]; contradictions?: Array<Record<string, unknown>> }>(
    root,
    ATLAS_FILES.codeLinks,
  );

  if (!intelligence) missingArtifacts.push(ATLAS_FILES.intelligence);
  if (!graph) missingArtifacts.push(ATLAS_FILES.graph);
  if (!packetSemantics) missingArtifacts.push(ATLAS_FILES.packetSemantics);
  if (!codeLinks) missingArtifacts.push(ATLAS_FILES.codeLinks);

  const contradictions = [
    ...(intelligence?.contradictions ?? []),
    ...(packetSemantics?.contradictions ?? []),
    ...(codeLinks?.contradictions ?? []),
  ].map(contradictionSummary);

  const namedJourneys = Array.isArray(intelligence?.journeys)
    ? intelligence.journeys.length
    : intelligence?.claims?.analysis_map_journeys ?? null;
  const claimedJourneys = intelligence?.claims?.current_state_journeys ?? null;
  const namedKernels = Array.isArray(intelligence?.kernels)
    ? intelligence.kernels.length
    : intelligence?.claims?.analysis_map_kernels ?? null;
  const claimedKernels = intelligence?.claims?.current_state_kernels ?? null;

  const verifiedAt = intelligence?.verified_at ?? null;
  let status: AtlasFreshness = 'UNKNOWN';
  if (contradictions.length > 0 || intelligence?.status === 'CONTRADICTED') {
    status = 'CONTRADICTED';
  } else if (verifiedAt) {
    const ageMs = now.getTime() - new Date(verifiedAt).getTime();
    status = Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= 7 * 24 * 60 * 60 * 1000 ? 'FRESH' : 'STALE';
  }

  const layerBasis = 'Layer completion is not assigned a percentage until each layer has an evidence-backed denominator.';
  const layerStatus = (id: string): 'MAPPED' | 'PARTIAL' | 'UNVERIFIED' | 'CONTRADICTED' => {
    if (status === 'CONTRADICTED' && (id === 'L2' || id === 'L8')) return 'CONTRADICTED';
    if (id === 'L2' || id === 'L3') return intelligence ? 'MAPPED' : 'UNVERIFIED';
    if (id === 'L6') return codeLinks ? 'PARTIAL' : 'UNVERIFIED';
    if (id === 'L7') return packetSemantics ? 'PARTIAL' : 'UNVERIFIED';
    return graph ? 'PARTIAL' : 'UNVERIFIED';
  };

  return {
    status,
    schema: graph?.schema ?? intelligence?.schema ?? null,
    verifiedAt,
    sourceRef: intelligence?.source_ref ?? null,
    journeyCount: {
      named: namedJourneys,
      claimed: claimedJourneys,
      status: countStatus(namedJourneys, claimedJourneys),
    },
    kernelCount: {
      named: namedKernels,
      claimed: claimedKernels,
      status: countStatus(namedKernels, claimedKernels),
    },
    graph: {
      nodes: Array.isArray(graph?.nodes) ? graph.nodes.length : null,
      edges: Array.isArray(graph?.edges) ? graph.edges.length : null,
      packetSemanticStatus: graph?.source_state?.packet_semantic_status ?? packetSemantics?.status ?? null,
      packetSemanticPackets:
        graph?.source_state?.packet_semantic_packets ??
        (Array.isArray(packetSemantics?.packets) ? packetSemantics.packets.length : null),
      verifiedCodeLinks:
        graph?.source_state?.verified_code_links ??
        (Array.isArray(codeLinks?.links) ? codeLinks.links.length : null),
    },
    layers: ATLAS_LAYER_LABELS.map(([id, label]) => ({
      id,
      label,
      status: layerStatus(id),
      progress: { completed: null, total: null, basis: layerBasis },
    })),
    contradictions,
    missingArtifacts,
  };
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
    const atlas = buildAtlasProjection(findRepositoryRoot());
    const blockers: ProjectMissionControlSnapshot['blockers'] = atlas.contradictions.map((item) => ({
      source: item.id,
      detail: `${item.subject}: ${item.detail}`,
    }));

    const workstreams: MissionControlWorkstream[] = [
      {
        id: 'living-atlas',
        label: 'Living System Atlas',
        phase: 'MATERIALIZE / VERIFY / MISSION CONTROL INTEGRATION',
        status: atlas.status,
        progress: {
          completed: null,
          total: null,
          basis: 'Atlas-wide completion has no accepted bounded denominator yet; layer evidence is shown separately.',
        },
        nextLegalAction: 'Reconcile Atlas artifacts into the read-only owner control panel; preserve contradictions and unknowns.',
      },
      {
        id: 'mission-control',
        label: 'Owner Mission Control',
        phase: 'READ MODEL / CONTROL PANEL',
        status: 'IMPLEMENTING',
        progress: {
          completed: null,
          total: null,
          basis: 'UI completion is not assigned a percentage until a bounded acceptance checklist is admitted.',
        },
        nextLegalAction: 'Prove the read model first, then wire the Atlas views. No mutation controls yet.',
      },
    ];

    if (!this.token) {
      return {
        generatedAt,
        repository: this.repository,
        sourceMain: null,
        freshness: {
          status: 'DEGRADED',
          github: 'UNAVAILABLE',
          atlas: atlas.status,
          detail: 'KEYFLOW_GITHUB_TOKEN or GITHUB_TOKEN is required for live GitHub evidence.',
        },
        health: atlas.status === 'CONTRADICTED' ? 'YELLOW' : 'UNKNOWN',
        workstreams,
        pullRequests: [],
        blockers: [
          ...blockers,
          { source: 'mission-control', detail: 'Authenticated GitHub evidence unavailable; no green state is inferred.' },
        ],
        workers: [],
        atlas,
      };
    }

    try {
      const main = await this.github<{ commit?: { sha?: string } }>('/branches/main');
      const sourceMain = main.commit?.sha ?? null;
      const openPulls = await this.github<GitHubPullRequest[]>('/pulls?state=open&per_page=100');
      const relevant = openPulls
        .filter((pullRequest) => {
          const branchName = pullRequest.head?.ref ?? '';
          const title = pullRequest.title ?? '';
          return (
            branchName.startsWith('impl/kf-') ||
            branchName.startsWith('docs/kf-') ||
            title.startsWith('KF-')
          );
        })
        .sort((a, b) => a.number - b.number);

      const pullRequests = await Promise.all(
        relevant.map((pullRequest) => this.pullRequestSnapshot(pullRequest.number)),
      );

      for (const pullRequest of pullRequests) {
        if (pullRequest.health === 'RED') {
          blockers.push({
            source: `PR #${pullRequest.number}`,
            detail: 'One or more exact-current-head checks are failing.',
          });
        }
      }

      return {
        generatedAt,
        repository: this.repository,
        sourceMain,
        freshness: { status: 'LIVE', github: 'AVAILABLE', atlas: atlas.status, detail: null },
        health: aggregateProgrammeHealth(pullRequests, atlas.status),
        workstreams,
        pullRequests,
        blockers,
        workers: [],
        atlas,
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return {
        generatedAt,
        repository: this.repository,
        sourceMain: null,
        freshness: { status: 'DEGRADED', github: 'UNAVAILABLE', atlas: atlas.status, detail },
        health: atlas.status === 'CONTRADICTED' ? 'YELLOW' : 'UNKNOWN',
        workstreams,
        pullRequests: [],
        blockers: [
          ...blockers,
          { source: 'mission-control', detail: 'Live GitHub evidence unavailable; no green state is inferred.' },
        ],
        workers: [],
        atlas,
      };
    }
  }

  private async pullRequestSnapshot(number: number): Promise<MissionControlPullRequest> {
    const pullRequest = await this.github<GitHubPullRequest>(`/pulls/${number}`);
    const headSha = pullRequest.head?.sha ?? null;
    let checks: MissionControlCheck[] = [];
    if (headSha) {
      const response = await this.github<{ check_runs?: GitHubCheckRun[] }>(
        `/commits/${headSha}/check-runs?per_page=100`,
      );
      checks = (response.check_runs ?? []).map(normalizeCheck);
    }
    return {
      number,
      title: pullRequest.title ?? `PR #${number}`,
      headSha,
      branch: pullRequest.head?.ref ?? null,
      draft: pullRequest.draft ?? null,
      mergeable: pullRequest.mergeable ?? null,
      mergeableState: pullRequest.mergeable_state ?? null,
      updatedAt: pullRequest.updated_at ?? null,
      checks,
      proof: proofProgress(checks),
      health: healthFromChecks(checks),
    };
  }

  private async github<T>(requestPath: string): Promise<T> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'keyflowos-mission-control',
      'X-GitHub-Api-Version': '2022-11-28',
      Authorization: `Bearer ${this.token}`,
    };

    const response = await fetch(
      `https://api.github.com/repos/${this.repository}${requestPath}`,
      { headers, signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) throw new Error(`GitHub ${response.status} for ${requestPath}`);
    return response.json() as Promise<T>;
  }
}
