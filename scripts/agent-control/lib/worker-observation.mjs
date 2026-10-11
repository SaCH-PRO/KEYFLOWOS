/**
 * What the local worker is doing, read from the files it already writes.
 *
 * The worker's state was only visible to someone who read its log. Twice that
 * hid a worker that was alive and useless: 1,650 identical errors over three
 * days from a worker whose scripts had left the disk, and a directive that
 * failed the same way every two minutes because its worktree could not be
 * made. Neither was held, escalated, or shown anywhere.
 *
 * This module reads; it never writes, never contacts GitHub and never touches
 * the worker. Everything comes from the worker's state directory:
 *
 *   cursor.json     -> completed
 *   attempts.json   -> failed (retryable) and blocked (held)
 *   comments.json   -> queued: the worker's last snapshot of the control room,
 *                      put through the same selector the worker uses
 *   worker.log      -> running, the last tick, and errors that repeat
 *   worker.lock, paused.json, install.json -> the worker itself
 *
 * `attention` lists what a person should look at. A worker that is fine has
 * none. It is a report, not a gate: nothing reads it to decide anything.
 */

import fs from 'node:fs';
import path from 'node:path';
import { selectDirective } from '../select-directive.mjs';
import { AUTHORIZED_AUTHORS } from './control-envelope.mjs';

/** A tick older than this is not a worker that is polling (the default interval is 120s). */
export const STALE_TICK_SECONDS = 600;

/** This many ticks in a row ending in the same error is a loop, not a blip. */
export const REPEATING_ERROR_TICKS = 3;

const LOG_LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) \[([A-Z_]+)\] (.*)$/;

/** Windows PowerShell 5.1 writes a BOM; a file that is absent is not an error. */
function readJson(file) {
  if (!fs.existsSync(file)) return { present: false, value: null, error: null };
  try {
    return { present: true, value: JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')), error: null };
  } catch (error) {
    return { present: true, value: null, error: error.message };
  }
}

export function parseLog(text) {
  const entries = [];
  for (const line of String(text).replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(LOG_LINE);
    if (m) entries.push({ at: m[1], level: m[2], message: m[3] });
  }
  return entries;
}

/**
 * A tick ends in exactly one line that says how it went. Lines such as
 * "created worktree" or a permission-denial warning belong to a tick but do
 * not end it.
 */
function tickOutcome(entry) {
  const { level, message } = entry;
  if (level === 'ERROR' || level === 'PAUSED' || level === 'HELD_RETRYABLE' || level.startsWith('WAITING_')) return level;
  if (level === 'INFO' && (message === 'no unprocessed directive' || message.startsWith('claude completed for ') || message.startsWith('DRY RUN:'))) return 'OK';
  return null;
}

/** The session the log says is running: an "invoking claude" with no verdict after it. */
function runningFrom(entries) {
  let running = null;
  for (const e of entries) {
    const invoked = e.message.match(/^invoking claude for (\S+) \(([^)]*)\), attempt (\d+)/);
    if (e.level === 'INFO' && invoked) { running = { message_id: invoked[1], packet_id: invoked[2], attempt: Number(invoked[3]), since: e.at }; continue; }
    if (!running) continue;
    if (e.message.startsWith(`claude completed for ${running.message_id}`) || e.message.startsWith(`run verdict for ${running.message_id}`)) running = null;
    // A restart ends whatever the previous process was running.
    else if (e.message.startsWith('worker started')) running = null;
  }
  return running;
}

/** The same error ending tick after tick, most recent first. */
function repeatingError(entries) {
  const outcomes = entries.filter((e) => tickOutcome(e));
  let count = 0;
  let message = null;
  let first = null;
  for (let i = outcomes.length - 1; i >= 0; i -= 1) {
    const e = outcomes[i];
    if (e.level !== 'ERROR') break;
    if (message === null) message = e.message;
    if (e.message !== message) break;
    count += 1;
    first = e.at;
  }
  return count >= REPEATING_ERROR_TICKS ? { message, ticks: count, since: first, last: outcomes[outcomes.length - 1].at } : null;
}

/**
 * @param {string} stateDir  <RepoRoot>/.agent-control/.worker
 * @param {{now?: Date, authors?: string[]}} options
 */
export function observeWorker(stateDir, options = {}) {
  const now = options.now || new Date();
  const authors = options.authors || AUTHORIZED_AUTHORS;
  const file = (name) => path.join(stateDir, name);
  if (!fs.existsSync(stateDir)) {
    return { present: false, state_dir: stateDir, attention: [{ code: 'NO_WORKER_STATE', detail: 'no worker has run from this checkout' }] };
  }

  const attention = [];
  const unreadable = (name, error) => attention.push({ code: 'STATE_UNREADABLE', detail: `${name}: ${error}` });

  const cursorFile = readJson(file('cursor.json'));
  if (cursorFile.error) unreadable('cursor.json', cursorFile.error);
  const processed = Array.isArray(cursorFile.value?.processed_message_ids) ? cursorFile.value.processed_message_ids : [];

  const ledgerFile = readJson(file('attempts.json'));
  if (ledgerFile.error) unreadable('attempts.json', ledgerFile.error);
  const ledger = Array.isArray(ledgerFile.value?.entries) ? ledgerFile.value.entries : [];
  const brief = (e) => ({ message_id: e.message_id, packet_id: e.packet_id ?? null, attempts: e.attempts ?? null, last_failure: e.last_signature ?? null });
  const blocked = ledger.filter((e) => e.held).map((e) => ({ ...brief(e), held_at: e.held_at ?? null, held_reason: e.held_reason ?? null, escalation_posted: e.escalation_posted === true }));
  const failed = ledger.filter((e) => !e.held).map(brief);

  const lock = readJson(file('worker.lock'));
  const install = readJson(file('install.json'));
  const paused = fs.existsSync(file('paused.json'));

  let entries = [];
  if (fs.existsSync(file('worker.log'))) {
    try { entries = parseLog(fs.readFileSync(file('worker.log'), 'utf8')); } catch (error) { unreadable('worker.log', error.message); }
  }
  const last = entries[entries.length - 1] || null;
  const tickAge = last ? Math.round((now.getTime() - Date.parse(last.at)) / 1000) : null;
  const running = runningFrom(entries);
  const repeating = repeatingError(entries);
  const lastOutcome = [...entries].reverse().find((e) => tickOutcome(e)) || null;

  // Queued: what the selector would hand the worker from its last snapshot.
  // A session can run for an hour, so a snapshot is as old as the last tick.
  let queued = [];
  let selection = null;
  const comments = readJson(file('comments.json'));
  if (comments.error) unreadable('comments.json', comments.error);
  else if (comments.present && Array.isArray(comments.value?.comments)) {
    const decision = selectDirective({ comments: comments.value.comments, processed, authors });
    selection = decision.output.reason;
    if (decision.output.selected) queued = [{ message_id: decision.output.selected.message_id, message_type: decision.output.selected.message_type, packet_id: decision.output.selected.packet_id }];
  }
  // The selector offers a held directive again on every tick; the worker
  // declines it. It is blocked, not queued.
  queued = queued.filter((q) => !blocked.some((b) => b.message_id === q.message_id));
  // A directive being worked on right now is running, not queued.
  if (running) queued = queued.filter((q) => q.message_id !== running.message_id);

  if (!last) attention.push({ code: 'NO_LOG', detail: 'the worker has logged nothing' });
  else if (!running && tickAge > STALE_TICK_SECONDS) attention.push({ code: 'TICKS_STOPPED', detail: `last log line ${tickAge}s ago (${last.at}); the worker is not polling, or the machine was asleep` });
  if (paused) attention.push({ code: 'PAUSED', detail: 'every tick is a no-op until claude-worker.ps1 -Resume' });
  if (repeating) attention.push({ code: 'ERROR_REPEATING', detail: `${repeating.ticks} ticks in a row since ${repeating.since}: ${repeating.message}` });
  if (lastOutcome && lastOutcome.level.startsWith('WAITING_')) attention.push({ code: lastOutcome.level, detail: lastOutcome.message });
  for (const b of blocked) attention.push({ code: 'DIRECTIVE_HELD', detail: `${b.message_id}: ${b.held_reason}${b.escalation_posted ? '' : ' (escalation NOT posted)'}` });
  for (const f of failed) attention.push({ code: 'DIRECTIVE_FAILED_RETRYABLE', detail: `${f.message_id}: ${f.attempts} attempt(s), last ${f.last_failure}` });
  // Queued with a clean ledger while ticks keep ending in the same error is
  // the silent loop: a directive that is offered, fails before it is counted,
  // and is offered again.
  if (queued.length && repeating) attention.push({ code: 'QUEUED_BUT_NOT_DELIVERED', detail: `${queued[0].message_id} is unprocessed and every recent tick ended in an error` });

  return {
    present: true,
    state_dir: stateDir,
    observed_at: now.toISOString(),
    worker: {
      lock_pid: lock.value?.pid ?? null,
      lock_started_at: lock.value?.started_at ?? null,
      repo_root: lock.value?.repo_root ?? null,
      install_contract: install.value?.contract_version ?? null,
      paused,
      last_log_at: last?.at ?? null,
      last_log_age_seconds: tickAge,
      last_tick_outcome: lastOutcome ? { at: lastOutcome.at, level: lastOutcome.level, message: lastOutcome.message } : null,
    },
    queued,
    selection,
    running,
    blocked,
    failed,
    completed: {
      count: processed.length,
      last_message_id: cursorFile.value?.last_message_id ?? null,
      last_processed_at: cursorFile.value?.last_processed_at ?? null,
      recent: processed.slice(-5),
    },
    repeating_error: repeating,
    attention,
    healthy: attention.length === 0,
  };
}

export function renderWorker(o) {
  const lines = ['KEYFLOWOS LOCAL WORKER (read from its own state files)', '='.repeat(60)];
  lines.push(`State dir      : ${o.state_dir}`);
  if (!o.present) { lines.push('No worker state here.'); return lines.join('\n'); }
  const w = o.worker;
  lines.push(`Process (lock) : pid ${w.lock_pid ?? '-'} since ${w.lock_started_at ?? '-'}${w.paused ? '  PAUSED' : ''}`);
  lines.push(`Last tick      : ${w.last_tick_outcome ? `${w.last_tick_outcome.at} [${w.last_tick_outcome.level}] ${w.last_tick_outcome.message}` : '-'}`);
  lines.push(`Last log line  : ${w.last_log_at ?? '-'} (${w.last_log_age_seconds ?? '-'}s ago)`);
  lines.push('');
  lines.push(`Queued         : ${o.queued.length ? o.queued.map((q) => `${q.message_id} (${q.message_type})`).join(', ') : 'none'}${o.selection ? `   [selector: ${o.selection}]` : ''}`);
  lines.push(`Running        : ${o.running ? `${o.running.message_id}, attempt ${o.running.attempt}, since ${o.running.since}` : 'none'}`);
  lines.push(`Blocked (held) : ${o.blocked.length ? o.blocked.map((b) => b.message_id).join(', ') : 'none'}`);
  lines.push(`Failed, retry  : ${o.failed.length ? o.failed.map((f) => `${f.message_id} x${f.attempts}`).join(', ') : 'none'}`);
  lines.push(`Completed      : ${o.completed.count}; last ${o.completed.last_message_id ?? '-'} at ${o.completed.last_processed_at ?? '-'}`);
  lines.push('');
  if (o.attention.length) {
    lines.push('ATTENTION:');
    for (const a of o.attention) lines.push(`  ${a.code}: ${a.detail}`);
  } else {
    lines.push('Attention      : none');
  }
  return lines.join('\n');
}

export default { observeWorker, renderWorker, parseLog, STALE_TICK_SECONDS, REPEATING_ERROR_TICKS };
