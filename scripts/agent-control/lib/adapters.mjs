/**
 * AUTO-AGENT-ADAPTERS — vendor-neutral agent contract.
 *
 * No vendor is canonical. An adapter declares which ROLE it can fill; the
 * orchestrator asks for a role, never for a brand.
 *
 * Hard rule: a missing or expired credential produces WAITING_EXTERNAL_AGENT.
 * It must never produce a false success, and no adapter may fill the
 * adversarial-review role for work produced by the same adapter id.
 */

import { spawnSync } from 'node:child_process';

export const ROLES = Object.freeze({
  BUILDER: 'builder',
  ADVERSARIAL_REVIEWER: 'adversarial_reviewer',
  ARCHITECTURE_AUTHORITY: 'architecture_authority',
});

export const AGENT_STATUS = Object.freeze({
  READY: 'READY',
  WAITING_EXTERNAL_AGENT: 'WAITING_EXTERNAL_AGENT',
  DISABLED: 'DISABLED',
});

/**
 * @typedef {object} Adapter
 * @property {string} id            stable identifier, e.g. "claude-code-local"
 * @property {string} vendor        informational only
 * @property {string[]} roles       roles this adapter may fill
 * @property {() => {status:string, detail?:string}} probeAuth
 * @property {(task:object) => object} invoke
 */

/**
 * On Windows the `claude` entry point is a `.cmd`/`.ps1` shim. Node cannot
 * spawn those directly (it fails ENOENT), so the shell is required there. The
 * prompt is never passed through the shell as an argument — it goes on stdin —
 * so enabling the shell introduces no quoting or injection surface.
 */
const NEEDS_SHELL = process.platform === 'win32';

function commandExists(cmd) {
  const probe = NEEDS_SHELL ? spawnSync('where', [cmd], { encoding: 'utf8', shell: true }) : spawnSync('which', [cmd], { encoding: 'utf8' });
  return probe.status === 0 && String(probe.stdout || '').trim() !== '';
}

/**
 * Claude Code local worker adapter.
 *
 * Uses the developer's already-authenticated interactive session. It passes no
 * credential and reads no token, so nothing secret is ever committed or logged.
 */
export function claudeLocalAdapter(options = {}) {
  const bin = options.bin || process.env.KEYFLOW_CLAUDE_BIN || 'claude';
  return {
    id: 'claude-code-local',
    vendor: 'anthropic',
    roles: [ROLES.BUILDER],
    probeAuth() {
      if (process.env.KEYFLOW_AGENT_CLAUDE_DISABLED === '1') {
        return { status: AGENT_STATUS.DISABLED, detail: 'disabled by KEYFLOW_AGENT_CLAUDE_DISABLED' };
      }
      if (!commandExists(bin)) {
        return { status: AGENT_STATUS.WAITING_EXTERNAL_AGENT, detail: `${bin} is not on PATH` };
      }
      const probe = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 30000, shell: NEEDS_SHELL });
      if (probe.status !== 0) {
        const why = probe.error ? probe.error.code : `exited ${probe.status}`;
        return { status: AGENT_STATUS.WAITING_EXTERNAL_AGENT, detail: `${bin} --version ${why}` };
      }
      return { status: AGENT_STATUS.READY, detail: String(probe.stdout || '').trim() };
    },
    invoke(task) {
      const auth = this.probeAuth();
      if (auth.status !== AGENT_STATUS.READY) return { status: auth.status, detail: auth.detail, output: null };
      // The prompt goes on stdin, never argv: it keeps arbitrary prompt text
      // away from the shell and avoids command-length limits.
      const args = ['-p', '--output-format', 'json'];
      if (task.model) args.push('--model', task.model);
      const run = spawnSync(bin, args, {
        encoding: 'utf8',
        timeout: task.timeout_ms || 3_600_000,
        cwd: task.cwd || process.cwd(),
        maxBuffer: 64 * 1024 * 1024,
        shell: NEEDS_SHELL,
        input: task.prompt,
      });
      if (run.status !== 0) {
        return { status: 'FAILED', detail: `exit ${run.status}`, stderr: run.stderr, output: null };
      }
      let parsed = null;
      try {
        parsed = JSON.parse(run.stdout);
      } catch {
        return { status: 'FAILED', detail: 'adapter did not return parseable JSON', output: run.stdout };
      }
      if (parsed.is_error) return { status: 'FAILED', detail: parsed.result || 'agent reported an error', output: parsed };
      return { status: 'COMPLETED', output: parsed.result, session_id: parsed.session_id || null, raw: parsed };
    },
  };
}

/**
 * OpenAI-shaped adapter for adversarial review / architecture authority.
 * Configuration hook only: it declares what it needs and reports WAITING
 * until that is supplied out of band. No secret is read from the repository.
 */
export function openAiAdapter(options = {}) {
  const envVar = options.apiKeyEnv || 'KEYFLOW_AGENT_OPENAI_API_KEY';
  return {
    id: options.id || 'openai-reviewer',
    vendor: 'openai',
    roles: options.roles || [ROLES.ADVERSARIAL_REVIEWER],
    required_config: [envVar],
    probeAuth() {
      if (process.env.KEYFLOW_AGENT_OPENAI_DISABLED === '1') {
        return { status: AGENT_STATUS.DISABLED, detail: 'disabled by KEYFLOW_AGENT_OPENAI_DISABLED' };
      }
      if (!process.env[envVar]) {
        return { status: AGENT_STATUS.WAITING_EXTERNAL_AGENT, detail: `${envVar} is not set` };
      }
      return { status: AGENT_STATUS.READY, detail: 'credential present (not validated offline)' };
    },
    invoke() {
      const auth = this.probeAuth();
      if (auth.status !== AGENT_STATUS.READY) return { status: auth.status, detail: auth.detail, output: null };
      // Intentionally not implemented: wiring a live review call is a separate,
      // credentialed decision. Reporting WAITING is correct; faking is not.
      return {
        status: AGENT_STATUS.WAITING_EXTERNAL_AGENT,
        detail: 'adapter configured but live invocation is not enabled in this package',
        output: null,
      };
    },
  };
}

/** A secondary reviewer slot so review never shares an identity with the builder. */
export function secondaryReviewerAdapter(options = {}) {
  const envVar = options.apiKeyEnv || 'KEYFLOW_AGENT_SECONDARY_API_KEY';
  return {
    id: options.id || 'secondary-reviewer',
    vendor: options.vendor || 'unspecified',
    roles: [ROLES.ADVERSARIAL_REVIEWER],
    required_config: [envVar],
    probeAuth() {
      if (!process.env[envVar]) {
        return { status: AGENT_STATUS.WAITING_EXTERNAL_AGENT, detail: `${envVar} is not set` };
      }
      return { status: AGENT_STATUS.READY, detail: 'credential present (not validated offline)' };
    },
    invoke() {
      return {
        status: AGENT_STATUS.WAITING_EXTERNAL_AGENT,
        detail: 'secondary reviewer is a configuration hook in this package',
        output: null,
      };
    },
  };
}

export function defaultRegistry() {
  return [claudeLocalAdapter(), openAiAdapter(), secondaryReviewerAdapter()];
}

/**
 * Pick an adapter for a role.
 * `excludeIds` enforces no-self-review: the builder that produced the work may
 * never be selected to adversarially review it.
 */
export function selectAdapter(registry, role, excludeIds = []) {
  const candidates = registry.filter((a) => a.roles.includes(role) && !excludeIds.includes(a.id));
  if (!candidates.length) {
    return { adapter: null, status: AGENT_STATUS.WAITING_EXTERNAL_AGENT, detail: `no adapter available for role ${role}` };
  }
  for (const adapter of candidates) {
    const auth = adapter.probeAuth();
    if (auth.status === AGENT_STATUS.READY) return { adapter, status: AGENT_STATUS.READY, detail: auth.detail };
  }
  const first = candidates[0].probeAuth();
  return { adapter: null, status: AGENT_STATUS.WAITING_EXTERNAL_AGENT, detail: first.detail, role };
}

export function agentStatusReport(registry) {
  return registry.map((a) => {
    const probe = a.probeAuth();
    return { id: a.id, vendor: a.vendor, roles: a.roles, status: probe.status, detail: probe.detail || null };
  });
}

export default {
  ROLES,
  AGENT_STATUS,
  claudeLocalAdapter,
  openAiAdapter,
  secondaryReviewerAdapter,
  defaultRegistry,
  selectAdapter,
  agentStatusReport,
};
