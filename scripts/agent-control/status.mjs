#!/usr/bin/env node
/**
 * AUTO-STATUS — programme status in machine and human form.
 *
 * Renders the derived programme-state and the static DAG. programme-state is a
 * projection, not authority: with --verify it is reconciled against the newest
 * #80 authority and repository truth (lib/reconcile.mjs) and every
 * disagreement is shown. Without --verify the status is labelled UNVERIFIED.
 *
 * Usage: node scripts/agent-control/status.mjs [--json] [--verify]
 */

import { loadState, projectionDrift } from './lib/state.mjs';
import { loadDag, selectNext } from './lib/dag.mjs';
import { evaluateMomentum } from './lib/momentum.mjs';
import { defaultRegistry, agentStatusReport } from './lib/adapters.mjs';
import { reconcileWithTruth } from './lib/truth.mjs';

export function buildStatus(repoRoot = process.cwd(), options = {}) {
  const state = options.state || loadState(repoRoot);
  const dag = options.dag || loadDag(repoRoot);
  const p = state.programme || {};

  const completed = p.checkpointed || [];
  const selection = selectNext(dag, completed);
  const momentum = evaluateMomentum(state, options.momentumExtra || {});
  const drift = projectionDrift(state, options.boardProjection || null);

  const completedPackets = new Set(
    completed.map((key) => String(key).split('#')[0]).filter((id) => dag.byPacket.has(id)),
  );

  return {
    programme: {
      packets_total: dag.packetsTotal,
      phases_total: dag.phasesTotal,
      checkpointed: completedPackets.size,
      active: p.active_packet ? 1 : 0,
      waiting: dag.packetsTotal - completedPackets.size - (p.active_packet ? 1 : 0),
      gate_wave: selection.gate_wave,
    },
    active_packet: {
      packet_id: p.active_packet,
      phase: p.active_phase,
      state: p.state,
      health: p.health,
      source_main: p.source_main,
      branch: p.implementation_branch,
      pr_number: p.pr_number,
      production_touched: Boolean(p.production_touched),
      merge_authority: Boolean(p.merge_authority),
    },
    hold: state.hold || null,
    contradictions: state.unresolved_contradictions || [],
    momentum: { alarm: momentum.alarm, reasons: momentum.reasons },
    agents: agentStatusReport(options.registry || defaultRegistry()),
    next_dependency_safe: selection.selected
      ? {
          key: selection.selected.key,
          packet_id: selection.selected.packet_id,
          phase: selection.selected.phase,
          wave: selection.selected.wave,
        }
      : null,
    eligible_count: selection.eligible.length,
    projection_drift: drift,
    authority_basis: state.authority_basis || null,
    // null = not checked. The projection is only usable when this is consistent.
    reconciliation: options.reconciliation || null,
    last_processed_event_key: state.last_processed_event_key || null,
    journal_entries: (state.event_journal || []).length,
  };
}

export function renderHuman(status) {
  const lines = [];
  const pr = status.programme;
  const ap = status.active_packet;

  lines.push('KEYFLOWOS PROGRAMME STATUS (derived projection)');
  lines.push('='.repeat(60));
  const basis = status.authority_basis;
  lines.push(`Anchored to    : ${basis ? `${basis.message_id} (comment ${basis.comment_id})` : '(none -- unanchored)'}`);
  if (!status.reconciliation) {
    lines.push('Reconciliation : UNVERIFIED -- run with --verify; do not act on this projection alone');
  } else if (status.reconciliation.consistent) {
    lines.push('Reconciliation : CONSISTENT with newest #80 authority and repository truth');
  } else {
    lines.push('Reconciliation : DRIFT -- projection is stale or contradicted; it advances nothing');
    for (const f of status.reconciliation.findings) {
      lines.push(`  ${f.code}${f.detail === null ? '' : ' ' + JSON.stringify(f.detail)}`);
    }
  }
  lines.push('');
  lines.push(`Packets        : ${pr.packets_total} total / ${pr.checkpointed} checkpointed / ${pr.active} active / ${pr.waiting} waiting`);
  lines.push(`Phases         : ${pr.phases_total} (spanning packets modelled per phase)`);
  lines.push(`Wave gate      : ${pr.gate_wave}`);
  lines.push('');
  lines.push(`Active packet  : ${ap.packet_id || '(none)'}${ap.phase ? ' #' + ap.phase : ''}`);
  lines.push(`State / health : ${ap.state || '-'} / ${ap.health || '-'}`);
  lines.push(`Branch / PR    : ${ap.branch || '-'} / ${ap.pr_number ? '#' + ap.pr_number : '-'}`);
  lines.push(`source_main    : ${ap.source_main || '-'}`);
  lines.push(`Production     : ${ap.production_touched ? 'TOUCHED — ESCALATE' : 'not touched'}`);
  lines.push(`Merge authority: ${ap.merge_authority ? 'GRANTED' : 'false (default)'}`);
  lines.push('');

  if (status.hold) {
    lines.push(`HOLD           : ${status.hold.reason || 'active'}`);
    if (status.hold.resume_condition) lines.push(`  resume when : ${status.hold.resume_condition}`);
    lines.push('');
  }

  lines.push(`Contradictions : ${status.contradictions.length ? status.contradictions.join(', ') : 'none'}`);
  lines.push(`Momentum alarm : ${status.momentum.alarm ? 'ACTIVE — ' + status.momentum.reasons.join(', ') : 'none'}`);
  lines.push('');

  lines.push('Agents:');
  for (const agent of status.agents) {
    lines.push(`  ${agent.id.padEnd(22)} ${agent.status.padEnd(24)} ${agent.detail || ''}`);
  }
  lines.push('');

  lines.push(
    `Next dependency-safe: ${status.next_dependency_safe ? status.next_dependency_safe.key + ' (wave ' + status.next_dependency_safe.wave + ')' : '(none selectable)'}`,
  );
  lines.push(`Eligible now        : ${status.eligible_count}`);
  lines.push(`Journal entries     : ${status.journal_entries}  last key: ${status.last_processed_event_key || '-'}`);

  if (status.projection_drift?.drift) {
    lines.push('');
    lines.push('BOARD DRIFT (intelligence board disagrees with programme-state; neither advances work):');
    for (const d of status.projection_drift.details) {
      lines.push(`  ${d.field}: programme-state=${d.live} board=${d.projection}`);
    }
  }

  return lines.join('\n');
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('status.mjs');
if (invokedDirectly) {
  try {
    const state = loadState(process.cwd());
    const reconciliation = process.argv.includes('--verify') ? reconcileWithTruth(state) : null;
    const status = buildStatus(process.cwd(), { state, reconciliation });
    process.stdout.write(process.argv.includes('--json') ? JSON.stringify(status, null, 2) + '\n' : renderHuman(status) + '\n');
  } catch (error) {
    process.stderr.write(`status failed: ${error.message}\n`);
    process.exit(2);
  }
}

export default { buildStatus, renderHuman };
