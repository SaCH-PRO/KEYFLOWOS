import { Injectable, Logger } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Read-only ChatGPT -> Claude handoff viewer for the owner console
 * (KF-META-HANDOFF-MONITOR-001, scope issue #178, H1).
 *
 * The projection and the GitHub collection are not implemented here. They
 * live once, in scripts/agent-control/lib/handoff-{projector,collector}.mjs,
 * which read issue #80 through the admitted control-envelope parser. This
 * service loads those modules and holds one demand-driven monitor:
 *
 *   - default off: with no KEYFLOW_HANDOFF_MONITOR_GITHUB_TOKEN it answers
 *     NOT_CONFIGURED and makes no request;
 *   - GET only, this repository's issue #80 and PR pages only, enforced by the
 *     collector's allowlist, not by this file;
 *   - cache in process memory only. A restart starts empty and rebuilds on the
 *     next request; nothing is written to the database;
 *   - a fixture mode (KEYFLOW_HANDOFF_MONITOR_FIXTURE) for loopback proof,
 *     refused when NODE_ENV is production.
 *
 * The production image copies only dist/, so the shared modules are absent
 * there and this answers UNAVAILABLE rather than failing.
 */

export type HandoffMonitorMode = 'LIVE' | 'FIXTURE' | 'NOT_CONFIGURED' | 'UNAVAILABLE';

export interface HandoffSnapshotQuery {
  task?: number;
  limit?: number;
  includeNoise?: boolean;
}

export interface HandoffSnapshotResponse {
  mode: HandoffMonitorMode;
  detail: string | null;
  refresh_hint_ms: number;
  freshness: Record<string, unknown> | null;
  view: Record<string, unknown> | null;
}

/** Browser refresh target while the page is visible. */
export const BROWSER_REFRESH_HINT_MS = 15_000;

const MODULE_DIR = path.join('scripts', 'agent-control', 'lib');
const PROJECTOR = 'handoff-projector.mjs';

export type EsmImporter = (specifier: string) => Promise<Record<string, unknown>>;

// tsc emits CommonJS here, which rewrites `import()` into `require()`, and
// require() cannot load an .mjs module on Node 20.18. This keeps a native
// dynamic import. The specifier is always a file URL built from a path
// resolved below, never request input. (vitest evaluates modules in a VM
// context without an import callback, so its specs pass their own importer.)
const importEsm = new Function('specifier', 'return import(specifier)') as EsmImporter;

interface Monitor {
  read(options?: { refresh?: boolean }): Promise<{ snapshot: unknown; freshness: Record<string, unknown> }>;
}

interface Loaded {
  monitor: Monitor;
  viewOf: (snapshot: unknown, options: Record<string, unknown>) => Record<string, unknown>;
  mode: 'LIVE' | 'FIXTURE';
}

/** Where scripts/agent-control/lib lives, or null when this build does not ship it. */
export function resolveSharedModuleDir(
  env: NodeJS.ProcessEnv = process.env,
  start: string = __dirname,
): string | null {
  const roots: string[] = [];
  if (env.KEYFLOW_REPOSITORY_ROOT) roots.push(path.resolve(env.KEYFLOW_REPOSITORY_ROOT));
  let dir = start;
  for (let i = 0; i < 8; i += 1) {
    roots.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const root of roots) {
    const candidate = path.join(root, MODULE_DIR);
    if (fs.existsSync(path.join(candidate, PROJECTOR))) return candidate;
  }
  return null;
}

function refreshMs(env: NodeJS.ProcessEnv): number | undefined {
  const value = Number(env.KEYFLOW_HANDOFF_MONITOR_REFRESH_MS);
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(Math.max(value, 10_000), 600_000);
}

@Injectable()
export class HandoffMonitorService {
  private readonly logger = new Logger(HandoffMonitorService.name);
  private loading: Promise<Loaded | { unavailable: HandoffSnapshotResponse }> | null = null;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    private readonly importer: EsmImporter = importEsm,
  ) {}

  /** Which source this process would read, without touching it. */
  configuredMode(): HandoffMonitorMode {
    if (this.env.KEYFLOW_HANDOFF_MONITOR_FIXTURE) {
      return this.env.NODE_ENV === 'production' ? 'UNAVAILABLE' : 'FIXTURE';
    }
    return this.env.KEYFLOW_HANDOFF_MONITOR_GITHUB_TOKEN ? 'LIVE' : 'NOT_CONFIGURED';
  }

  async snapshot(query: HandoffSnapshotQuery = {}): Promise<HandoffSnapshotResponse> {
    const mode = this.configuredMode();
    if (mode === 'NOT_CONFIGURED') {
      return this.empty('NOT_CONFIGURED', 'No GitHub read credential is configured for the handoff viewer; it is off by default.');
    }
    if (mode === 'UNAVAILABLE') {
      return this.empty('UNAVAILABLE', 'Fixture mode is refused when NODE_ENV is production.');
    }
    if (!this.loading) this.loading = this.load(mode);
    const loaded = await this.loading;
    if ('unavailable' in loaded) return loaded.unavailable;

    const { snapshot, freshness } = await loaded.monitor.read();
    return {
      mode: loaded.mode,
      detail: null,
      refresh_hint_ms: BROWSER_REFRESH_HINT_MS,
      freshness,
      view: snapshot
        ? loaded.viewOf(snapshot, { task: query.task, limit: query.limit, includeNoise: query.includeNoise === true })
        : null,
    };
  }

  private empty(mode: HandoffMonitorMode, detail: string): HandoffSnapshotResponse {
    return { mode, detail, refresh_hint_ms: BROWSER_REFRESH_HINT_MS, freshness: null, view: null };
  }

  private async load(mode: 'LIVE' | 'FIXTURE'): Promise<Loaded | { unavailable: HandoffSnapshotResponse }> {
    const dir = resolveSharedModuleDir(this.env);
    if (!dir) {
      return { unavailable: this.empty('UNAVAILABLE', 'The shared handoff projector (scripts/agent-control) is not present in this build.') };
    }
    try {
      const url = (file: string) => pathToFileURL(path.join(dir, file)).href;
      const projector = await this.importer(url(PROJECTOR));
      const collector = await this.importer(url('handoff-collector.mjs'));
      const createMonitor = collector.createHandoffMonitor as (options: Record<string, unknown>) => Monitor;
      const config = refreshMs(this.env) ? { minRefreshMs: refreshMs(this.env) } : {};
      let transport: unknown;
      if (mode === 'FIXTURE') {
        const fixtures = await this.importer(url('handoff-fixture-transport.mjs'));
        const data = (fixtures.loadFixture as (file: string) => unknown)(path.resolve(String(this.env.KEYFLOW_HANDOFF_MONITOR_FIXTURE)));
        transport = (fixtures.createFixtureTransport as (data: unknown) => unknown)(data);
      } else {
        transport = (collector.createGithubTransport as (options: Record<string, unknown>) => unknown)({
          token: this.env.KEYFLOW_HANDOFF_MONITOR_GITHUB_TOKEN,
        });
      }
      return {
        mode,
        monitor: createMonitor({ transport, config }),
        viewOf: projector.viewOf as Loaded['viewOf'],
      };
    } catch (err) {
      // Never echo the error: it may name local paths. The log keeps the code.
      this.logger.warn(`handoff monitor failed to load: ${(err as { code?: string }).code ?? 'ERROR'}`);
      this.loading = null;
      return { unavailable: this.empty('UNAVAILABLE', 'The shared handoff projector could not be loaded.') };
    }
  }
}
