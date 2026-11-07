#!/usr/bin/env node
/**
 * CLOUD-DISPATCH CLI — Read-Only / Dry-Run Cloud Control Plane Inspector
 * (KF-META-CLOUD-DISPATCH-001)
 *
 * Validates cloud engineering task envelopes, handoff continuity records,
 * branch/commit integrity, scope boundaries, and lease ownership without
 * mutating repository state, merging pull requests, touching production, or
 * posting action-triggering messages to Issue #80.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CLOUD_REASONS,
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
  if (!ancestor || !descendant) return null;
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
    const res = validateCloudTask(task);
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
    const task = taskFile && fs.existsSync(path.resolve(cwd, taskFile))
      ? loadCloudYamlFile(path.resolve(cwd, taskFile))
      : null;
    const res = validateCloudHandoff(handoff, { task });
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
    const requireUnattended = argv.includes('--require-unattended');
    const res = dispatchCloudTask({
      task,
      nowIso,
      requireUnattended,
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

  const branchEnv = process.env.GITHUB_HEAD_REF || gitOutput(['symbolic-ref', '--short', 'HEAD'], cwd);
  const branchName = branchEnv && branchEnv !== 'HEAD' ? branchEnv : null;
  const headSha = gitOutput(['rev-parse', 'HEAD'], cwd);
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

  // Verify that task.source_main is an existing commit on trusted main when git is available.
  const catType = task?.source_main ? gitOutput(['cat-file', '-t', task.source_main], cwd) : null;
  if (headSha && task?.source_main && catType !== 'commit') {
    return {
      exitCode: 1,
      payload: {
        ok: false,
        mode: 'READ_ONLY_PREFLIGHT',
        reason: CLOUD_REASONS.SOURCE_COMMIT_NOT_ON_MAIN,
        problems: [`source_main ${task.source_main} does not resolve to a commit in git history`],
      },
    };
  }
  if (headSha && task?.source_main) {
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
  }

  const changedFiles = task?.source_main ? gitChangedFiles(task.source_main, 'HEAD', cwd) : null;
  const semanticHeadIsAncestor =
    handoff && headSha && handoff.semantic_head
      ? gitIsAncestor(handoff.semantic_head, headSha, cwd)
      : null;
  if (handoff && semanticHeadIsAncestor === false) {
    handoff.semantic_head_is_ancestor = false;
  }
  const tailChangedFiles =
    handoff && headSha && handoff.semantic_head
      ? gitChangedFiles(handoff.semantic_head, 'HEAD', cwd)
      : null;
  const nonControlTailFiles = Array.isArray(tailChangedFiles)
    ? tailChangedFiles.filter((filePath) => !filePath.startsWith('.agent-control/'))
    : null;

  const result = evaluateCloudPreflight({
    task,
    handoff,
    activePacket,
    returnArtifact,
    branchName,
    headSha,
    mainSha: expectedMainSha || task?.source_main || null,
    changedFiles,
    semanticHeadIsAncestor,
    nonControlTailFiles,
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

export default { runCloudDispatchCli };
