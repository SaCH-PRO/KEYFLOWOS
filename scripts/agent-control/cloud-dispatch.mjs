#!/usr/bin/env node
/**
 * CLOUD-DISPATCH CLI — Read-Only / Dry-Run Cloud Control Plane Inspector
 * (KF-META-CLOUD-DISPATCH-001)
 *
 * Validates cloud engineering task envelopes, authenticated authority records,
 * handoff continuity records, branch/commit ancestry integrity, scope boundaries,
 * and lease ownership without mutating repository state, merging pull requests,
 * touching production, or posting action-triggering messages to Issue #80.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CLOUD_REASONS,
  computeTaskContractDigest,
  defaultCloudProviderRegistry,
  dispatchCloudTask,
  evaluateCloudPreflight,
  loadCloudYamlFile,
  validateCloudHandoff,
  validateCloudTask,
} from './lib/cloud-control.mjs';

function argValue(argv, flag, fallback = null) {
  const idx = argv.indexOf(flag);
  if (idx >= 0 && idx + 1 < argv.length && !argv[idx + 1].startsWith('--')) {
    return argv[idx + 1];
  }
  return fallback;
}

function gitOutput(args, cwd = process.cwd()) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (res.status !== 0) return null;
  return res.stdout.trim();
}

function gitIsAncestor(ancestor, descendant, cwd = process.cwd()) {
  if (!ancestor || !descendant) return false;
  const res = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
    cwd,
    encoding: 'utf8',
  });
  return res.status === 0;
}

function gitChangedFiles(baseRef, headRef = 'HEAD', cwd = process.cwd()) {
  if (!baseRef) return null;
  const res = spawnSync('git', ['diff', '--name-only', `${baseRef}..${headRef}`], {
    cwd,
    encoding: 'utf8',
  });
  if (res.status !== 0) return null;
  return res.stdout
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function loadStructuredFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  if (filePath.endsWith('.json')) {
    return JSON.parse(raw);
  }
  return loadCloudYamlFile(filePath);
}

/**
 * Resolves an authenticated authority record from explicit options, a
 * `--verified-authority <file>` CLI argument, or a verified GitHub Actions
 * event payload (`GITHUB_EVENT_PATH`) bound to the task's immutable contract
 * digest. Returns `null` when only unverified YAML claims are available.
 */
export function resolveVerifiedAuthority(task, argv = [], cwd = process.cwd(), options = {}) {
  if (options.verifiedAuthority) {
    return options.verifiedAuthority;
  }
  const authFileArg = argValue(argv, '--verified-authority');
  if (authFileArg) {
    const full = path.resolve(cwd, authFileArg);
    if (fs.existsSync(full)) {
      return loadStructuredFile(full);
    }
    return null;
  }
  const eventPath =
    options.githubEventPath !== undefined
      ? options.githubEventPath
      : process.env.GITHUB_EVENT_PATH || null;
  if (eventPath && fs.existsSync(eventPath) && task && typeof task === 'object') {
    try {
      const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
      const actor =
        event?.pull_request?.user?.login ||
        event?.sender?.login ||
        null;
      const approvalId = task?.authority?.approval_id || null;
      const declaredDigest = task?.authority?.contract_digest || null;
      const computedDigest = computeTaskContractDigest(task);
      const prHeadRef = event?.pull_request?.head?.ref || null;
      const prBaseSha = event?.pull_request?.base?.sha || null;

      if (
        actor &&
        approvalId &&
        declaredDigest &&
        declaredDigest === computedDigest &&
        (!prHeadRef || prHeadRef === task.implementation_branch) &&
        (!prBaseSha || prBaseSha === task.source_main)
      ) {
        return {
          authenticated: true,
          approval_id: approvalId,
          actor,
          source_kind: task.authority.kind,
          reference: task.authority.reference,
          task_id: task.task_id,
          packet_id: task.packet_id,
          implementation_branch: task.implementation_branch,
          source_main: task.source_main,
          contract_digest: declaredDigest,
        };
      }
    } catch {
      return null;
    }
  }
  return null;
}

export function runCloudDispatchCli(argv = process.argv.slice(2), options = {}) {
  const cwd = options.cwd || process.cwd();
  const nowIso = options.nowIso || process.env.CLOUD_CONTROL_NOW_ISO || new Date().toISOString();

  // Hard security gate: reject any mutating or forbidden flags immediately.
  if (argv.includes('--merge')) {
    return {
      exitCode: 2,
      payload: {
        ok: false,
        mode: 'REJECTED_MUTATION',
        reason: CLOUD_REASONS.MERGE_NOT_AUTHORIZED,
        problems: ['--merge is forbidden in cloud-dispatch; Phase 1 cloud control has no merge authority'],
      },
    };
  }
  if (argv.includes('--deploy') || argv.includes('--touch-production')) {
    return {
      exitCode: 2,
      payload: {
        ok: false,
        mode: 'REJECTED_MUTATION',
        reason: CLOUD_REASONS.PRODUCTION_NOT_AUTHORIZED,
        problems: ['production deployment or mutation is forbidden in cloud-dispatch'],
      },
    };
  }
  if (argv.includes('--post-issue-80')) {
    return {
      exitCode: 2,
      payload: {
        ok: false,
        mode: 'REJECTED_MUTATION',
        reason: CLOUD_REASONS.LEGACY_ISSUE80_TRIGGER_FORBIDDEN,
        problems: ['posting action-triggering messages to Issue #80 is forbidden while legacy selector is recipient-blind'],
      },
    };
  }

  if (argv.includes('--status')) {
    const adapters = defaultCloudProviderRegistry().map((a) => a.probeStatus());
    const taskPath = path.resolve(cwd, argValue(argv, '--task', '.agent-control/cloud-task.yaml'));
    const taskPresent = fs.existsSync(taskPath);
    const task = taskPresent ? loadCloudYamlFile(taskPath) : null;
    return {
      exitCode: 0,
      payload: {
        ok: true,
        mode: 'READ_ONLY_STATUS',
        automated_provider_invocation: 'DEFERRED_PHASE_2',
        adapters,
        active_task: task
          ? {
              task_id: task.task_id,
              packet_id: task.packet_id,
              provider: task.provider,
              agent_identity: task.agent_identity,
              implementation_branch: task.implementation_branch,
              state: task.state,
            }
          : null,
      },
    };
  }

  const validateTaskArg = argValue(argv, '--validate-task');
  if (validateTaskArg) {
    const full = path.resolve(cwd, validateTaskArg);
    if (!fs.existsSync(full)) {
      return {
        exitCode: 2,
        payload: {
          ok: false,
          mode: 'VALIDATE_TASK',
          reason: CLOUD_REASONS.TASK_INVALID,
          problems: [`task file not found: ${validateTaskArg}`],
        },
      };
    }
    const task = loadCloudYamlFile(full);
    const verifiedAuthority = resolveVerifiedAuthority(task, argv, cwd, options);
    const res = validateCloudTask(task, { verifiedAuthority });
    return {
      exitCode: res.ok ? 0 : 1,
      payload: { mode: 'VALIDATE_TASK', ...res },
    };
  }

  const validateHandoffArg = argValue(argv, '--validate-handoff');
  if (validateHandoffArg) {
    const full = path.resolve(cwd, validateHandoffArg);
    if (!fs.existsSync(full)) {
      return {
        exitCode: 2,
        payload: {
          ok: false,
          mode: 'VALIDATE_HANDOFF',
          reason: CLOUD_REASONS.HANDOFF_INVALID,
          problems: [`handoff file not found: ${validateHandoffArg}`],
        },
      };
    }
    const handoff = loadCloudYamlFile(full);
    const taskFile = argValue(argv, '--task');
    const task =
      taskFile && fs.existsSync(path.resolve(cwd, taskFile))
        ? loadCloudYamlFile(path.resolve(cwd, taskFile))
        : null;
    const verifiedAncestry =
      options.verifiedAncestry || {
        sourceMainIsAncestorOfSemanticHead: gitIsAncestor(
          handoff?.source_main,
          handoff?.semantic_head,
          cwd,
        ),
        semanticHeadIsAncestorOfPrHead: gitIsAncestor(
          handoff?.semantic_head,
          handoff?.pr_head,
          cwd,
        ),
      };
    const res = validateCloudHandoff(handoff, {
      task,
      verifiedAncestry,
      verifiedCiEvidence: options.verifiedCiEvidence || null,
    });
    return {
      exitCode: res.ok ? 0 : 1,
      payload: { mode: 'VALIDATE_HANDOFF', ...res },
    };
  }

  const dispatchArg = argValue(argv, '--dispatch');
  if (dispatchArg) {
    const full = path.resolve(cwd, dispatchArg);
    if (!fs.existsSync(full)) {
      return {
        exitCode: 2,
        payload: {
          ok: false,
          mode: 'DISPATCH_DRY_RUN',
          reason: CLOUD_REASONS.TASK_INVALID,
          problems: [`task file not found: ${dispatchArg}`],
        },
      };
    }
    const task = loadCloudYamlFile(full);
    const verifiedAuthority = resolveVerifiedAuthority(task, argv, cwd, options);
    const requireUnattended = argv.includes('--require-unattended');
    const res = dispatchCloudTask({
      task,
      nowIso,
      requireUnattended,
      verifiedAuthority,
    });
    return {
      exitCode: res.ok ? 0 : 1,
      payload: { mode: 'DISPATCH_DRY_RUN', ...res },
    };
  }

  // Default / --preflight mode
  const taskPath = path.resolve(cwd, argValue(argv, '--task', '.agent-control/cloud-task.yaml'));
  if (!fs.existsSync(taskPath)) {
    return {
      exitCode: 2,
      payload: {
        ok: false,
        mode: 'READ_ONLY_PREFLIGHT',
        reason: CLOUD_REASONS.TASK_INVALID,
        problems: [`cloud task file not found: ${path.relative(cwd, taskPath)}`],
      },
    };
  }

  const task = loadCloudYamlFile(taskPath);
  const handoffPath = path.resolve(cwd, argValue(argv, '--handoff', '.agent-control/cloud-handoff.yaml'));
  const packetPath = path.resolve(cwd, argValue(argv, '--packet', '.agent-control/active-packet.yaml'));
  const returnPath = path.resolve(cwd, argValue(argv, '--return', '.agent-control/claude-return.yaml'));

  const handoff = fs.existsSync(handoffPath) ? loadCloudYamlFile(handoffPath) : null;
  const activePacket = fs.existsSync(packetPath) ? loadCloudYamlFile(packetPath) : null;
  const returnArtifact = fs.existsSync(returnPath) ? loadCloudYamlFile(returnPath) : null;

  const branchEnv =
    options.branchName ||
    process.env.GITHUB_HEAD_REF ||
    gitOutput(['symbolic-ref', '--short', 'HEAD'], cwd);
  const branchName = branchEnv && branchEnv !== 'HEAD' ? branchEnv : null;
  const headSha = options.headSha !== undefined ? options.headSha : gitOutput(['rev-parse', 'HEAD'], cwd);

  // Fail closed when git HEAD or branch state is missing or detached without GITHUB_HEAD_REF.
  if (!headSha || !/^[0-9a-f]{40}$/.test(headSha)) {
    return {
      exitCode: 1,
      payload: {
        ok: false,
        mode: 'READ_ONLY_PREFLIGHT',
        reason: CLOUD_REASONS.INVALID_SOURCE_COMMIT,
        problems: ['unable to resolve a valid 40-hex git HEAD SHA; preflight fails closed'],
      },
    };
  }
  if (!branchName) {
    return {
      exitCode: 1,
      payload: {
        ok: false,
        mode: 'READ_ONLY_PREFLIGHT',
        reason: CLOUD_REASONS.TASK_INVALID,
        problems: ['unable to resolve current git branch name; preflight fails closed'],
      },
    };
  }

  const expectedMainSha =
    options.expectedMainSha ||
    argValue(argv, '--expected-main') ||
    process.env.EXPECTED_BASE_SHA ||
    null;
  const trustedMainSha =
    expectedMainSha ||
    gitOutput(['rev-parse', '--verify', 'refs/remotes/origin/main'], cwd) ||
    gitOutput(['rev-parse', '--verify', 'refs/heads/main'], cwd) ||
    null;

  // Verify that task.source_main is an existing commit on trusted main.
  const catType = task?.source_main ? gitOutput(['cat-file', '-t', task.source_main], cwd) : null;
  if (!task?.source_main || catType !== 'commit') {
    return {
      exitCode: 1,
      payload: {
        ok: false,
        mode: 'READ_ONLY_PREFLIGHT',
        reason: CLOUD_REASONS.SOURCE_COMMIT_NOT_ON_MAIN,
        problems: [`source_main ${task?.source_main || '<missing>'} does not resolve to a commit in git history`],
      },
    };
  }
  if (!trustedMainSha || gitIsAncestor(task.source_main, trustedMainSha, cwd) !== true) {
    return {
      exitCode: 1,
      payload: {
        ok: false,
        mode: 'READ_ONLY_PREFLIGHT',
        reason: CLOUD_REASONS.SOURCE_COMMIT_NOT_ON_MAIN,
        problems: [
          `source_main ${task.source_main} is not on trusted main (${trustedMainSha || 'unresolved'})`,
        ],
      },
    };
  }
  if (expectedMainSha && task.source_main !== expectedMainSha) {
    return {
      exitCode: 1,
      payload: {
        ok: false,
        mode: 'READ_ONLY_PREFLIGHT',
        reason: CLOUD_REASONS.SOURCE_COMMIT_NOT_ON_MAIN,
        problems: [
          `source_main ${task.source_main} does not match expected main SHA ${expectedMainSha}`,
        ],
      },
    };
  }
  if (gitIsAncestor(task.source_main, headSha, cwd) !== true) {
    return {
      exitCode: 1,
      payload: {
        ok: false,
        mode: 'READ_ONLY_PREFLIGHT',
        reason: CLOUD_REASONS.SOURCE_COMMIT_NOT_ON_MAIN,
        problems: [`source_main ${task.source_main} is not an ancestor of current HEAD ${headSha}`],
      },
    };
  }

  const changedFiles = gitChangedFiles(task.source_main, headSha, cwd);
  if (!Array.isArray(changedFiles)) {
    return {
      exitCode: 1,
      payload: {
        ok: false,
        mode: 'READ_ONLY_PREFLIGHT',
        reason: CLOUD_REASONS.SCOPE_VIOLATION,
        problems: [`failed to compute changed files between ${task.source_main} and ${headSha}`],
      },
    };
  }

  const sourceMainIsAncestor =
    handoff && handoff.semantic_head
      ? gitIsAncestor(task.source_main, handoff.semantic_head, cwd)
      : gitIsAncestor(task.source_main, headSha, cwd);
  const semanticHeadIsAncestor =
    handoff && handoff.semantic_head
      ? gitIsAncestor(handoff.semantic_head, headSha, cwd)
      : null;
  if (handoff && semanticHeadIsAncestor === false) {
    handoff.semantic_head_is_ancestor = false;
  }
  if (handoff && sourceMainIsAncestor === false) {
    handoff.source_main_is_ancestor = false;
  }
  const tailChangedFiles =
    handoff && handoff.semantic_head
      ? gitChangedFiles(handoff.semantic_head, headSha, cwd)
      : null;
  if (handoff && !Array.isArray(tailChangedFiles)) {
    return {
      exitCode: 1,
      payload: {
        ok: false,
        mode: 'READ_ONLY_PREFLIGHT',
        reason: CLOUD_REASONS.STALE_COMPLETION_EVIDENCE,
        problems: [`failed to compute tail diff between semantic_head (${handoff.semantic_head}) and HEAD (${headSha})`],
      },
    };
  }
  const nonControlTailFiles = Array.isArray(tailChangedFiles)
    ? tailChangedFiles.filter((filePath) => !filePath.startsWith('.agent-control/'))
    : null;

  const verifiedAuthority = resolveVerifiedAuthority(task, argv, cwd, options);

  const result = evaluateCloudPreflight({
    task,
    handoff,
    activePacket,
    returnArtifact,
    branchName,
    headSha,
    mainSha: expectedMainSha || task.source_main,
    changedFiles,
    sourceMainIsAncestor,
    semanticHeadIsAncestor,
    nonControlTailFiles,
    verifiedAuthority,
    verifiedCiEvidence: options.verifiedCiEvidence || null,
    nowIso,
  });

  return {
    exitCode: result.ok ? 0 : 1,
    payload: result,
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (invokedDirectly) {
  const { exitCode, payload } = runCloudDispatchCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(exitCode);
}

export default { runCloudDispatchCli, resolveVerifiedAuthority };
