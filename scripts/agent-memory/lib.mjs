// Pure functions for the agent memory layer (status.mjs, bundle.mjs).
// No I/O here: everything takes parsed data and returns data, so node:test can cover it.

export const PLAN_PATH = 'docs/reconstruction/V1-PLAN-RECUT.json';
export const PRIOR_STATUS_PATH = 'docs/reconstruction/handoff/V1-STATUS-2026-11-20.json';
export const BUILD_MAP_PATH = 'docs/reconstruction/BUILD-MAP-001.md';
export const STATUS_JSON_PATH = 'docs/reconstruction/handoff/V1-STATUS.json';
export const STATUS_MD_PATH = 'docs/reconstruction/handoff/V1-STATUS.md';

export const SIZE_POINTS = { XS: 0.5, S: 1, M: 2, L: 3 };
export const points = (packet) => SIZE_POINTS[packet.size] ?? 0;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when `subject` names the packet id as a whole token (NAV-B-HIDE does not match NAV-B-HIDE-2). */
export function subjectNamesPacket(subject, id) {
  return new RegExp(`(?:pkt/V1-|(?<![A-Za-z0-9-]))${escapeRe(id)}(?![A-Za-z0-9-])`).test(subject);
}

/** Conventional-commit type of a subject ("fix", "test", ...), or "merge", or "other". */
export function subjectType(subject) {
  if (/^Merge /.test(subject)) return 'merge';
  const m = /^([a-z]+)(\([^)]*\))?!?:/.test(subject) ? subject.match(/^([a-z]+)/)[1] : null;
  return m ?? 'other';
}

const CODE_TYPES = new Set(['fix', 'feat', 'refactor', 'perf']);

/**
 * Evidence for one packet in the commits that reached main after the prior status file.
 * commits: [{ sha, subject }] (any order).
 */
export function commitEvidence(id, commits) {
  const named = commits.filter((c) => subjectNamesPacket(c.subject, id));
  const compacted = named.filter(
    (c) => CODE_TYPES.has(subjectType(c.subject)) && c.subject.includes(`pkt/V1-${id} (compacted)`),
  );
  const code = named.filter((c) => CODE_TYPES.has(subjectType(c.subject)));
  const other = named.filter((c) => !CODE_TYPES.has(subjectType(c.subject)));
  // compact.sh gives a tests-only packet (gate and census packets) exactly one commit, its RED commit.
  // The whole subject must be compact.sh's RED subject, so a revert or a two-packet subject never counts.
  const red = new RegExp(`^test(\\([^)]*\\))?: RED for pkt/V1-${escapeRe(id)} \\(compacted\\)$`);
  const testsOnly = named.filter((c) => red.test(c.subject));
  return { compacted, code, other, testsOnly };
}

/** A prior "wave-2b" row counts as merged only when a wave 2b commit is on main. */
export function wave2bMerged(commits) {
  return commits.some((c) => /^v1 wave 2b\b.*\(#\d+\)$/.test(c.subject) || /^Merge v1 wave 2b\b/.test(c.subject));
}

/**
 * Derive one packet's status.
 * Returns { status: 'done'|'in-progress'|'todo', derived_from, uncertain, evidence }.
 */
export function deriveStatus(packet, { priorRow, commits, wave2bOnMain, branches }) {
  const ev = commitEvidence(packet.id, commits);
  const shas = (list) => list.map((c) => c.sha.slice(0, 8));
  if (ev.compacted.length) {
    return { status: 'done', derived_from: 'compacted-commit', uncertain: false, evidence: shas(ev.compacted) };
  }
  if (ev.testsOnly.length) {
    return { status: 'done', derived_from: 'compacted-tests-only', uncertain: false, evidence: shas(ev.testsOnly) };
  }
  if (priorRow?.status === 'merged-main') {
    return { status: 'done', derived_from: 'prior-status-file', uncertain: false, evidence: [] };
  }
  if (priorRow?.status === 'wave-2b' && wave2bOnMain) {
    return { status: 'done', derived_from: 'prior-status-file+wave-2b-commit', uncertain: false, evidence: [] };
  }
  if (ev.code.length) {
    // A code commit on main names the packet, but not in the "(compacted)" form: likely done, not certain.
    return { status: 'done', derived_from: 'code-commit-subject', uncertain: true, evidence: shas(ev.code) };
  }
  const branch = (branches ?? []).find((b) => b === `pkt/V1-${packet.id}`);
  if (branch) {
    return { status: 'in-progress', derived_from: 'unmerged-branch', uncertain: true, evidence: [`origin/${branch}`] };
  }
  if (priorRow && priorRow.status !== 'todo') {
    return {
      status: 'in-progress',
      derived_from: `prior-status-file(${priorRow.status})`,
      uncertain: true,
      evidence: shas(ev.other),
    };
  }
  return {
    status: 'todo',
    derived_from: priorRow ? 'prior-status-file' : 'no-evidence',
    uncertain: false,
    evidence: [],
  };
}

/** For every packet, the set of packets that (transitively) wait on it. */
export function transitiveDependents(packets) {
  const direct = new Map(packets.map((p) => [p.id, []]));
  for (const p of packets) for (const d of p.depends_on ?? []) direct.get(d)?.push(p.id);
  const memo = new Map();
  const visit = (id) => {
    if (memo.has(id)) return memo.get(id);
    const out = new Set();
    memo.set(id, out); // the plan is acyclic; this only guards against a loop
    for (const child of direct.get(id) ?? []) {
      out.add(child);
      for (const g of visit(child)) out.add(g);
    }
    return out;
  };
  for (const p of packets) visit(p.id);
  return memo;
}

/** Longest chain of not-done packets through depends_on, weighted by size points. */
export function longestRemainingChain(packets, statusById) {
  const byId = new Map(packets.map((p) => [p.id, p]));
  const memo = new Map();
  const best = (id) => {
    if (memo.has(id)) return memo.get(id);
    const p = byId.get(id);
    let top = { weight: 0, chain: [] };
    memo.set(id, { weight: points(p), chain: [id] });
    for (const d of p.depends_on ?? []) {
      if (!byId.has(d) || statusById[d] === 'done') continue;
      const b = best(d);
      if (b.weight > top.weight) top = b;
    }
    const out = { weight: top.weight + points(p), chain: [...top.chain, id] };
    memo.set(id, out);
    return out;
  };
  let top = { weight: 0, chain: [] };
  for (const p of packets) {
    if (statusById[p.id] === 'done') continue;
    const b = best(p.id);
    if (b.weight > top.weight || (b.weight === top.weight && b.chain.join() < top.chain.join())) top = b;
  }
  return top;
}

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };

/** Informational liveness budget for ready packets (RR-STATUS-STALL-REPORT). */
export const STALL_BUDGET_DAYS = 14;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Parse an ISO-8601 date or timestamp (also accepting the plan's "YYYY-MM-DD HH:MMZ" form)
 * into { ms, iso }. Returns null for empty, malformed, or calendar-invalid dates.
 */
function parseIsoDate(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const m = trimmed.match(ISO_DATE_RE);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = m[4] === undefined ? 0 : Number(m[4]);
  const minute = m[5] === undefined ? 0 : Number(m[5]);
  const second = m[6] === undefined ? 0 : Number(m[6]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
  // Calendar round-trip rejects impossible dates such as 2026-02-30.
  const cal = new Date(Date.UTC(year, month - 1, day));
  if (cal.getUTCFullYear() !== year || cal.getUTCMonth() + 1 !== month || cal.getUTCDate() !== day) return null;
  let normalized;
  if (m[4] === undefined) {
    normalized = `${m[1]}-${m[2]}-${m[3]}T00:00:00Z`;
  } else {
    const frac = m[7] ? `.${m[7]}` : '';
    const tz = m[8] ?? 'Z';
    const sec = m[6] ?? '00';
    normalized = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${sec}${frac}${tz}`;
  }
  const ms = Date.parse(normalized);
  if (!Number.isFinite(ms)) return null;
  const iso = m[4] !== undefined && m[6] !== undefined && m[8] !== undefined && !trimmed.includes(' ') ? trimmed : normalized;
  return { ms, iso };
}

/** Extract the plan's leading snapshot timestamp (e.g. "2026-11-16 21:50Z; ...") as ISO-8601, or null. */
export function planSnapshotDate(plan) {
  const raw = typeof plan?._about?.snapshot === 'string'
    ? plan._about.snapshot
    : (typeof plan?.snapshot_date === 'string' ? plan.snapshot_date : null);
  if (!raw) return null;
  const m = raw.trim().match(/^(\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?)(?=$|[\s;,)])/);
  if (!m) return null;
  return parseIsoDate(m[1])?.iso ?? null;
}

function newestCommitDate(list) {
  let best = null;
  for (const c of list ?? []) {
    const parsed = parseIsoDate(c?.date);
    if (parsed && (!best || parsed.ms > best.ms)) best = parsed;
  }
  return best?.iso ?? null;
}

/**
 * Packets that can start now: status todo and every depends_on done.
 * Ranked: on the plan's critical path first, then by how many not-done packets wait on it,
 * then priority, then id.
 */
export function readyList(packets, statusById, criticalPath, options = {}) {
  const {
    mainDate = null,
    snapshotDate = null,
    evidenceDateById = {},
    stallBudgetDays = STALL_BUDGET_DAYS,
  } = options;
  const mainParsed = parseIsoDate(mainDate);
  const snapParsed = parseIsoDate(snapshotDate);
  const budgetMs = stallBudgetDays * MS_PER_DAY;
  const dependents = transitiveDependents(packets);
  const ids = new Set(packets.map((p) => p.id));
  const crit = new Set(criticalPath ?? []);
  return packets
    .filter((p) => statusById[p.id] === 'todo')
    .filter((p) => (p.depends_on ?? []).every((d) => ids.has(d) && statusById[d] === 'done'))
    .map((p) => {
      const deps = p.depends_on ?? [];
      let readySinceParsed = null;
      if (deps.length === 0) {
        readySinceParsed = snapParsed;
      } else {
        let newest = null;
        let allDated = true;
        for (const d of deps) {
          const parsed = parseIsoDate(evidenceDateById[d]);
          if (!parsed) {
            allDated = false;
            break;
          }
          if (!newest || parsed.ms > newest.ms) newest = parsed;
        }
        readySinceParsed = allDated ? newest : null;
      }
      const stalled = Boolean(mainParsed && readySinceParsed && (mainParsed.ms - readySinceParsed.ms) > budgetMs);
      return {
        id: p.id,
        step: p.step,
        priority: p.priority,
        size: p.size,
        lane: p.lane,
        track: p.track ?? null,
        on_critical_path: crit.has(p.id),
        unblocks: [...(dependents.get(p.id) ?? [])].filter((d) => statusById[d] !== 'done').length,
        ready_since: readySinceParsed ? readySinceParsed.iso : null,
        stalled,
      };
    })
    .sort(
      (a, b) =>
        Number(b.on_critical_path) - Number(a.on_critical_path) ||
        b.unblocks - a.unblocks ||
        (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) ||
        a.id.localeCompare(b.id),
    );
}

/** Build the whole status document from parsed inputs. Deterministic for the same inputs. */
export function buildStatus({ plan, prior, commits, branches, mainSha, mainDate, baseSha }) {
  const priorById = new Map((prior?.packets ?? []).map((r) => [r.id, r]));
  const wave2bOnMain = wave2bMerged(commits);
  const evidenceDateById = {};
  const rows = plan.packets.map((p) => {
    const d = deriveStatus(p, { priorRow: priorById.get(p.id), commits, wave2bOnMain, branches });
    if (d.status === 'done') {
      const ev = commitEvidence(p.id, commits);
      if (d.derived_from === 'compacted-commit') evidenceDateById[p.id] = newestCommitDate(ev.compacted);
      else if (d.derived_from === 'compacted-tests-only') evidenceDateById[p.id] = newestCommitDate(ev.testsOnly);
      else if (d.derived_from === 'code-commit-subject') evidenceDateById[p.id] = newestCommitDate(ev.code);
      else evidenceDateById[p.id] = null;
    }
    return {
      id: p.id,
      step: p.step,
      priority: p.priority,
      size: p.size,
      lane: p.lane,
      track: p.track ?? null,
      status: d.status,
      derived_from: d.derived_from,
      uncertain: d.uncertain,
      evidence: d.evidence,
      depends_on: p.depends_on ?? [],
      title: p.title,
    };
  });
  const statusById = Object.fromEntries(rows.map((r) => [r.id, r.status]));
  for (const r of rows) {
    r.deps_met = r.status === 'done' ? null : r.depends_on.every((d) => statusById[d] === 'done');
  }
  const totalPoints = plan.packets.reduce((s, p) => s + points(p), 0);
  const count = (pred) => rows.filter(pred).length;
  const pts = (pred) => plan.packets.filter((p, i) => pred(rows[i])).reduce((s, p) => s + points(p), 0);
  const by_status = {};
  for (const s of ['done', 'in-progress', 'todo']) {
    const n = count((r) => r.status === s);
    const share = totalPoints ? Math.round((pts((r) => r.status === s) / totalPoints) * 1000) / 10 : 0;
    by_status[s] = { packets: n, points: pts((r) => r.status === s), pct_by_points: share };
  }
  const by_step = {};
  for (const r of rows) {
    const s = (by_step[r.step] ??= { done: 0, 'in-progress': 0, todo: 0, total: 0 });
    s[r.status] += 1;
    s.total += 1;
  }
  // D-263: the launch gate runs on the launch track; follow-on packets ship after launch.
  const by_track = {};
  for (const r of rows) {
    const t = (by_track[r.track ?? 'none'] ??= { done: 0, 'in-progress': 0, todo: 0, total: 0 });
    t[r.status] += 1;
    t.total += 1;
  }
  const by_derivation = {};
  for (const r of rows) by_derivation[r.derived_from] = (by_derivation[r.derived_from] ?? 0) + 1;
  const planCritical = plan.validation?.critical_path ?? [];
  const ready = readyList(plan.packets, statusById, planCritical, {
    mainDate,
    snapshotDate: planSnapshotDate(plan),
    evidenceDateById,
    stallBudgetDays: STALL_BUDGET_DAYS,
  });
  const readyLaunch = ready.filter((r) => r.track === 'launch');
  return {
    _generated: {
      by: 'scripts/agent-memory/status.mjs',
      do_not_edit: 'Generated file. Change the inputs and re-run the script.',
      main_sha: mainSha,
      main_commit_date: mainDate,
      inputs: [PLAN_PATH, PRIOR_STATUS_PATH, `git log ${baseSha ? baseSha.slice(0, 8) : '(root)'}^..main (commit subjects)`, ...(branches ? ['local origin/pkt/V1-* refs (--with-branches)'] : [])],
      how_status_is_derived: {
        'compacted-commit': 'done: a fix/feat commit on main with subject "... pkt/V1-<ID> (compacted)". Certain.',
        'prior-status-file': 'done or todo as V1-STATUS-2026-11-20.json recorded it ("merged-main" or "todo"). Certain for done; todo means no later evidence was found.',
        'prior-status-file+wave-2b-commit': 'done: the prior file said "wave-2b" and the wave 2b commit is on main. Certain.',
        'code-commit-subject': 'done: a fix/feat commit on main names the packet id, but not in the compacted form. UNCERTAIN: the commit may be a partial or a repair.',
        'unmerged-branch': 'in-progress: only with --with-branches (never in the committed file). origin/pkt/V1-<ID> exists in this clone and no done evidence is on main. UNCERTAIN: depends on which branches this clone has fetched; a stale branch also counts.',
        'prior-status-file(in-progress)': 'in-progress: the prior file said so and nothing newer is on main. UNCERTAIN.',
        'prior-status-file(wave-2b)': 'in-progress: the prior file said "wave-2b" and no wave 2b commit is on main. UNCERTAIN. Cannot occur on main today.',
        'no-evidence': 'todo: the packet was added to the plan after the prior status file and no fix or feat commit on main names it (docs and test commits may).',
      },
      limits: [
        'Work on wave PRs, unpushed worktrees and child sessions is invisible here: see ORCHESTRATOR-STATE.md section 3.',
        'The committed file is a function of main alone, so it shows no in-progress work that is only on a branch. For a branch view run: git fetch origin "+refs/heads/pkt/*:refs/remotes/origin/pkt/*" && node scripts/agent-memory/status.mjs --with-branches --stdout',
        'A compacted commit that was later reverted still counts as done: the script reads subjects, not trees.',
        'The plan critical path was computed at the re-cut (validation.critical_path) and does not include packets added later.',
      ],
    },
    summary: {
      packets: rows.length,
      points: totalPoints,
      by_status,
      by_step,
      by_track,
      by_derivation,
      uncertain: rows.filter((r) => r.uncertain).map((r) => r.id),
      todo_with_dependencies_met: ready.length,
      todo_with_dependencies_met_launch: readyLaunch.length,
      stalled_ready: ready.filter((r) => r.stalled).length,
      stalled_ready_launch: readyLaunch.filter((r) => r.stalled).length,
    },
    critical_path: {
      plan_recorded_remaining: planCritical.filter((id) => statusById[id] !== 'done'),
      plan_recorded_total: planCritical.length,
      longest_remaining_depends_on_chain: longestRemainingChain(plan.packets, statusById),
    },
    ready,
    ready_launch: readyLaunch,
    packets: rows,
  };
}

/** Short Markdown view of the status document. */
export function renderStatusMd(status, { readyLimit = 25 } = {}) {
  const s = status.summary;
  const g = status._generated;
  const L = [];
  L.push('# V1 status (generated)', '');
  L.push(`Generated by \`${g.by}\` from main at \`${g.main_sha.slice(0, 8)}\` (${g.main_commit_date}). Do not edit: re-run the script.`);
  L.push(`Full rows, evidence and derivation rules: \`${STATUS_JSON_PATH}\`.`, '');
  L.push('## Counts', '', '| Status | Packets | Points | Share of points |', '|---|---|---|---|');
  for (const [k, v] of Object.entries(s.by_status)) L.push(`| ${k} | ${v.packets} | ${v.points} | ${v.pct_by_points}% |`);
  L.push(`| total | ${s.packets} | ${s.points} | |`, '');
  L.push('| Step | Done | In progress | Todo | Total |', '|---|---|---|---|---|');
  for (const [k, v] of Object.entries(s.by_step)) L.push(`| ${k} | ${v.done} | ${v['in-progress']} | ${v.todo} | ${v.total} |`);
  if (s.by_track) {
    L.push('', '| Track (D-263) | Done | In progress | Todo | Total |', '|---|---|---|---|---|');
    for (const [k, v] of Object.entries(s.by_track)) L.push(`| ${k} | ${v.done} | ${v['in-progress']} | ${v.todo} | ${v.total} |`);
  }
  L.push('', '## How each status was derived', '', '| Derivation | Packets |', '|---|---|');
  for (const [k, v] of Object.entries(s.by_derivation)) L.push(`| ${k} | ${v} |`);
  const unc = status.packets.filter((p) => p.uncertain);
  L.push('', unc.length ? `Uncertain (${unc.length}): ${unc.map((p) => `${p.id} (counted ${p.status}, ${p.derived_from})`).join(', ')}.` : 'Uncertain: none.');
  L.push('', 'Certain: compacted-commit and the two prior-status-file rows. Uncertain: code-commit-subject (a fix commit on main names the packet, but not in the "(compacted)" form, so it may be a partial or a repair). no-evidence: added to the plan later, nothing on main names it, counted todo.');
  L.push('', 'Not visible to this file: open wave PRs, unpushed worktrees, child sessions. Those are in `ORCHESTRATOR-STATE.md` section 3.', '');
  const cp = status.critical_path;
  L.push('## Remaining critical path', '');
  L.push(`Plan-recorded path (${cp.plan_recorded_remaining.length} of ${cp.plan_recorded_total} left; computed at the re-cut, so later packets are not on it):`, '');
  L.push(cp.plan_recorded_remaining.join(' > ') || '(none left)', '');
  const lc = cp.longest_remaining_depends_on_chain;
  L.push(`Longest remaining depends_on chain today (${lc.weight} points):`, '', lc.chain.join(' > ') || '(none)', '');
  const launch = status.ready_launch ?? status.ready;
  L.push(`## Ready to start, launch track (${launch.length}; D-263)`, '');
  L.push('Todo, every dependency done, `"track": "launch"`. Ranked: critical path first, then unblocks most, then priority.', '');
  L.push('"Ready" is judged from main alone. A packet here may already be claimed, in a wave PR or in a child session: check the board (`BOARD.md` on `coord/board`), `ORCHESTRATOR-STATE.md` section 3 and `git ls-remote origin refs/heads/pkt/V1-<ID>` before starting one.', '');
  L.push('| # | Packet | Step | Pri | Size | Lane | Critical | Unblocks |', '|---|---|---|---|---|---|---|---|');
  launch.slice(0, readyLimit).forEach((r, i) => {
    L.push(`| ${i + 1} | ${r.id} | ${r.step} | ${r.priority} | ${r.size} | ${r.lane} | ${r.on_critical_path ? 'yes' : ''} | ${r.unblocks} |`);
  });
  if (launch.length > readyLimit) L.push('', `(${launch.length - readyLimit} more in the JSON file, \`ready_launch\`.)`);
  if (status.ready_launch) {
    const followOn = status.ready.filter((r) => r.track === 'follow-on').length;
    const untracked = status.ready.length - launch.length - followOn;
    L.push('', `Follow-on packets ready (D-263; only on the owner's assignment): ${followOn}.${untracked ? ` Ready with no track: ${untracked}.` : ''} All ${status.ready.length} are in the JSON file, \`ready\`.`);
  }
  const stalled = status.ready.filter((r) => r.stalled);
  L.push('', `## Ready but stalled (${stalled.length}; > ${STALL_BUDGET_DAYS} days, informational)`, '');
  L.push(`Informational liveness signal from main alone (no wall clock, no branches, no automatic action; a person decides what a stall means). Budget: ${STALL_BUDGET_DAYS} days between \`ready_since\` and \`main_commit_date\`.`, '');
  if (!stalled.length) {
    L.push('(none)');
  } else {
    for (const r of stalled.slice(0, readyLimit)) {
      L.push(`- ${r.id} (${r.track ?? 'untracked'}, ${r.priority}, ${r.lane}, ready_since: ${r.ready_since})`);
    }
    if (stalled.length > readyLimit) L.push(`- (${stalled.length - readyLimit} more in the JSON file, \`ready\`.)`);
  }
  const inprog = status.packets.filter((p) => p.status === 'in-progress');
  if (inprog.length) {
    L.push('', '## In progress (as far as git shows)', '');
    for (const p of inprog) L.push(`- ${p.id} (${p.derived_from}${p.evidence.length ? ': ' + p.evidence.join(', ') : ''})`);
  }
  return L.join('\n') + '\n';
}

// ---------------------------------------------------------------- rulings (BUILD-MAP-001.md)

/**
 * Parse every table row "| D-nnn | text | effect |" with the heading it sits under.
 * Returns [{ id, text, effect, heading, line, slug }]. An id can appear twice
 * (the open question in section (g), then the ruling).
 */
export function parseRulings(markdown) {
  const out = [];
  let heading = '';
  markdown.split('\n').forEach((raw, i) => {
    const h = raw.match(/^#{2,4}\s+(.*)$/);
    if (h) {
      heading = h[1].trim();
      return;
    }
    // First cell is one id ("D-150") or a combined one ("D-41..D-45, D-47..D-52").
    const m = raw.match(/^\|\s*(D-\d+(?:\s*(?:\.\.|,)\s*D-\d+)*)\s*\|(.*)\|\s*$/);
    if (!m) return;
    const cells = m[2].split(/(?<!\\)\|/).map((c) => c.trim());
    const text = cells[0] ?? '';
    const slug = text.match(/\(`([a-z0-9-]+)`\)\s*$/)?.[1] ?? null;
    for (const id of expandRulingIds(m[1])) out.push({ id, text, effect: cells.slice(1).join(' | '), heading, line: i + 1, slug });
  });
  return out;
}

/** "D-41..D-43, D-47" -> ["D-41", "D-42", "D-43", "D-47"]. */
export function expandRulingIds(cell) {
  const ids = [];
  for (const part of cell.split(',')) {
    const [a, b] = part.split('..').map((x) => Number(x.trim().replace('D-', '')));
    for (let n = a; n <= (b ?? a); n += 1) ids.push(`D-${n}`);
  }
  return ids;
}

/** Resolve a plan "decisions" key (D-nnn, or a slug such as "hubs") to ruling rows. */
const OPEN_QUESTIONS_HEADING = /^\(g\) Open decisions/;

/**
 * Resolve a plan "decisions" key (D-nnn, or a slug such as "hubs") to ruling rows. A D-id first asked in the
 * open-decisions table and later ruled resolves to the ruling only (Codex review of #221); an id that was only ever
 * asked keeps its question row, marked unresolved.
 */
export function resolveDecision(key, rulings) {
  const id = key.match(/^D-\d+$/) ? key : null;
  const rows = id ? rulings.filter((r) => r.id === id) : rulings.filter((r) => r.slug === key);
  const ruled = rows.filter((r) => !OPEN_QUESTIONS_HEADING.test(r.heading));
  return ruled.length ? ruled : rows.map((r) => ({ ...r, unresolved: true }));
}

// ---------------------------------------------------------------- bundle

export const BRIEF_POINTERS = {
  worker_brief: 'docs/development/agent-memory/PACKET-WORKER-BRIEF.md',
  acceptance_review_brief: 'docs/development/agent-memory/ACCEPTANCE-REVIEW-BRIEF.md',
  confirmation_review_brief: 'docs/development/agent-memory/CONFIRMATION-REVIEW-BRIEF.md',
  wave_runbook: 'docs/development/agent-memory/WAVE-RUNBOOK.md',
  owner_question_format: 'docs/development/agent-memory/OWNER-QUESTION-FORMAT.md',
  handoff: 'docs/reconstruction/V1-HANDOFF-2026-11-20.md',
  plan: PLAN_PATH,
  rulings: BUILD_MAP_PATH,
  state: 'docs/reconstruction/handoff/ORCHESTRATOR-STATE.md',
};

const PROHIBITED = [
  'production or staging',
  'real provider traffic',
  'weakening or skipping a test or gate',
  'fabricated evidence',
  'secrets anywhere',
  '.agent-control/* and issue #273 posts (the orchestrator handles them; #80 is archived)',
  'Release 0 evidence files (scripts/proof-admission/manifests, release0-index.json) without an owner ruling',
];
const STOP_CONDITIONS = [
  'a factual premise the packet states about the code is false',
  'an owner decision the packet needs is missing',
  'the work needs a file outside the write set beyond a minimal, reported touch',
  'a Release 0 evidence file would have to change without an r0_register AMEND row under an owner ruling',
];

/**
 * Compile one packet's context bundle. Shape follows CONTEXT-BUNDLE-SCHEMA.yaml where it fits;
 * the extra top-level keys (packet, rulings, r0_register, write_set, dependencies, pointers)
 * and the fields left empty are listed in `departures`.
 * fileExists: (path) => boolean, checked at the snapshot ref.
 */
export function buildBundle({ plan, packetId, rulings, statusById, fileExists, mainSha, statusSource, ref = 'origin/main' }) {
  const packet = plan.packets.find((p) => p.id === packetId);
  if (!packet) return null;
  const reasons = [];
  const cited = (packet.decisions ?? []).map((key) => {
    const rows = resolveDecision(key, rulings);
    if (!rows.length) reasons.push(`ruling "${key}" not found in ${BUILD_MAP_PATH} at ${mainSha.slice(0, 8)}`);
    return { key, rows };
  });
  if (!rulings.some((r) => r.id === 'D-222')) reasons.push(`standing directive D-222 not found in ${BUILD_MAP_PATH} at ${mainSha.slice(0, 8)}`);
  const write_set = (packet.files ?? []).map((path) => ({ path, exists: Boolean(fileExists(path)) }));
  const dependencies = (packet.depends_on ?? []).map((id) => {
    const status = statusById[id] ?? 'unknown';
    if (status === 'unknown') reasons.push(`dependency ${id} is not a plan packet`);
    return { id, status };
  });
  const depsMet = dependencies.every((d) => d.status === 'done');
  const r0 = (plan.r0_register ?? []).filter((r) => r.packet === packetId);
  const prefixes = (plan.fixture_prefix_table ?? []).filter((r) => String(r.packet).includes(`(${packetId})`));
  const claim = (row) => ({
    claim: row.text,
    source: `${BUILD_MAP_PATH}:${row.line}`,
    revision: mainSha,
    authority_class: 'EXECUTION_AUTHORITY',
    freshness: 'CURRENT',
    confidence: null,
  });
  return {
    schema_version: 1,
    generator: { name: 'scripts/agent-memory/bundle.mjs', version: '1', deterministic: true },
    snapshot: {
      repository: 'KEYFLOWOS/KEYFLOWOS',
      main_sha: mainSha,
      ref,
      task_head_sha: null,
      packet_id: packetId,
      generated_from: [
        { source: PLAN_PATH, revision: mainSha },
        { source: BUILD_MAP_PATH, revision: mainSha },
        { source: statusSource, revision: mainSha },
      ],
    },
    health: { status: reasons.length ? 'DEGRADED' : 'VALID', reasons },
    task: {
      objective: packet.title,
      change_classes: [packet.lane, packet.kind, `step ${packet.step}`, packet.priority, `size ${packet.size}`],
      allowed_scope: (packet.files ?? []).slice(),
      prohibited_scope: PROHIBITED,
      stop_conditions: STOP_CONDITIONS,
    },
    authority: {
      current: {
        source: `${BUILD_MAP_PATH} (D-222, D-241)`,
        identifier: 'OWNER-DIR-V1-STANDING-001',
        revision: mainSha,
        freshness: rulings.some((r) => r.id === 'D-222') ? 'CURRENT' : 'UNVERIFIABLE',
      },
      conflicts: [],
    },
    semantic_context: {
      owners: [],
      journeys: packet.journeys ?? [],
      kernels: [],
      execution_paths: [],
      invariants: cited.flatMap((c) => c.rows.map(claim)),
      hotspots: [],
      historical_failure_classes: [],
    },
    proof_context: {
      reachability_checks: [],
      fastest_falsification: [],
      semantic_proofs: [packet.definition_of_done],
      adversarial_proofs: ['two independent reviews: security and tenancy; correctness and regression'],
      final_admission: [`see ${BRIEF_POINTERS.wave_runbook} (proof commands)`],
    },
    unresolved: {
      contradictions: [],
      unknowns: depsMet ? [] : [{ claim: 'not every dependency is done on main', source: statusSource, revision: mainSha, authority_class: 'DERIVED_PROJECTION', freshness: 'CURRENT', confidence: null }],
      missing_required_sources: cited.filter((c) => !c.rows.length).map((c) => c.key),
    },
    provenance: { claims: [] },
    excluded: {
      sources: [
        { source: 'issue #273 comments (and archived #80)', revision: null, reason: 'TOO_BROAD' },
        { source: `${BUILD_MAP_PATH} (rulings the packet does not cite)`, revision: mainSha, reason: 'IRRELEVANT' },
        { source: `${PLAN_PATH} (other packets)`, revision: mainSha, reason: 'IRRELEVANT' },
      ],
    },
    // --- extensions beyond the schema
    packet,
    rulings: cited,
    r0_register: r0,
    fixture_prefixes: prefixes,
    write_set,
    dependencies,
    dependencies_met: depsMet,
    pointers: BRIEF_POINTERS,
    departures: [
      'snapshot.main_sha is the sha of the ref that was read (snapshot.ref, an added field): origin/main unless --ref was given.',
      'Added top-level keys the schema does not have: packet, rulings, r0_register, fixture_prefixes, write_set, dependencies, dependencies_met, pointers, departures.',
      'Left empty (no deterministic source for them yet): semantic_context.owners, kernels, execution_paths, hotspots, historical_failure_classes; proof_context.reachability_checks, fastest_falsification; provenance.claims (each ruling carries its own source line under semantic_context.invariants instead).',
      'authority.conflicts and unresolved.contradictions are always empty: the script does not detect conflicts between rulings, it only reports rulings it cannot find.',
      'task.prohibited_scope and task.stop_conditions are the standing rules of the packet worker brief, not per-packet data.',
      'snapshot.task_head_sha is null: the bundle is compiled before the packet branch exists.',
    ],
  };
}

/** Markdown view of a bundle: what a worker reads. */
export function renderBundleMd(b) {
  const p = b.packet;
  const L = [];
  L.push(`# Context bundle: ${p.id}`, '');
  L.push(`Compiled by \`${b.generator.name}\` from \`${b.snapshot.ref}\` at \`${b.snapshot.main_sha.slice(0, 8)}\`. Derived: the plan and BUILD-MAP outrank it.`);
  L.push(`Health: ${b.health.status}${b.health.reasons.length ? ' (' + b.health.reasons.join('; ') + ')' : ''}`, '');
  L.push('## Packet', '');
  L.push(`- Title: ${p.title}`);
  L.push(`- Step ${p.step}, ${p.priority}, size ${p.size}, lane ${p.lane}, kind ${p.kind}; journeys: ${(p.journeys ?? []).join(', ') || 'none'}; bugs: ${(p.bugs ?? []).join(', ') || 'none'}`);
  L.push(`- Branch: \`pkt/V1-${p.id}\` based on origin/main`);
  if ((p.absorbs ?? []).length) L.push(`- Absorbs: ${p.absorbs.join(', ')}`);
  if (p.fixture_prefix) L.push(`- Fixture prefix: ${JSON.stringify(p.fixture_prefix)}`);
  for (const f of b.fixture_prefixes) L.push(`- Fixture prefix (plan table): \`${f.prefix}\` for ${f.owner}`);
  L.push('', '### Scope', '', p.scope, '', '### Definition of done', '', p.definition_of_done, '');
  L.push('### Release 0 impact', '', p.r0_impact ?? '(not stated)', '');
  L.push('## Dependencies', '');
  if (!b.dependencies.length) L.push('None.');
  for (const d of b.dependencies) L.push(`- ${d.id}: ${d.status}`);
  L.push('', b.dependencies_met ? 'All dependencies are done on main.' : 'NOT READY: a dependency is not done on main.', '');
  L.push('## Write set', '');
  for (const f of b.write_set) L.push(`- \`${f.path}\` (${f.exists ? 'exists' : 'new'})`);
  L.push('', '## Rulings cited', '');
  if (!b.rulings.length) L.push('None cited.');
  for (const c of b.rulings) {
    if (!c.rows.length) {
      L.push(`### ${c.key}`, '', `NOT FOUND in ${BUILD_MAP_PATH} at this ref. Ask the orchestrator before relying on it.`, '');
      continue;
    }
    for (const r of c.rows) {
      L.push(`### ${r.id}${c.key !== r.id ? ` (\`${c.key}\`)` : ''}, ${BUILD_MAP_PATH}:${r.line}, under "${r.heading}"`, '', r.text, '');
      if (r.effect) L.push(`Effect: ${r.effect}`, '');
    }
  }
  L.push('## Release 0 register rows', '');
  if (!b.r0_register.length) L.push('None for this packet.');
  for (const r of b.r0_register) L.push(`- ${r.r0_case}: ${r.change}`);
  L.push('', '## Read next (paths only)', '');
  for (const [k, v] of Object.entries(b.pointers)) L.push(`- ${k}: \`${v}\``);
  L.push('', '## Where this departs from CONTEXT-BUNDLE-SCHEMA.yaml', '');
  for (const d of b.departures) L.push(`- ${d}`);
  return L.join('\n') + '\n';
}

/** The status document without the fields that change with every commit on main (for --check). */
export function statusFingerprint(status) {
  const { main_sha: _sha, main_commit_date: _date, ...generated } = status._generated;
  return JSON.stringify({ ...status, _generated: generated });
}

/**
 * Whether the generated status files on disk are current: both must exist, the JSON must carry the same packet
 * status (the sha it records moves with every merge, so it is not compared), and the Markdown must equal what the
 * generator renders (Codex review of #221).
 */
export function statusFilesCurrent({ jsonText, mdText, status, md }) {
  if (jsonText == null) return { current: false, reason: 'V1-STATUS.json is missing' };
  if (mdText == null) return { current: false, reason: 'V1-STATUS.md is missing' };
  let onDisk;
  try {
    onDisk = JSON.parse(jsonText);
  } catch {
    return { current: false, reason: 'V1-STATUS.json does not parse' };
  }
  if (statusFingerprint(onDisk) !== statusFingerprint(status)) return { current: false, reason: 'packet status has changed' };
  const body = (t) => t.replace(/^Generated by .*$/m, '');
  if (body(mdText) !== body(md)) return { current: false, reason: 'V1-STATUS.md differs from what the generator renders' };
  return { current: true, reason: '' };
}

// ---------------------------------------------------------------- packet write-set matching (RR-HOOK-PACKET-SCOPE)

const REPO_ROOT_PREFIX_RE =
  /^(?:apps|packages|scripts|docs|architecture|infrastructure|prisma|public|src|test|tests|patches|artifacts|\.github|\.claude|\.agents|\.agent-control)\/[A-Za-z0-9._/*[\]-]*$/;
const TOP_LEVEL_FILE_RE =
  /^(?:CLAUDE\.md|AGENTS\.md|README\.md|SECURITY\.md|MAINTENANCE\.md|MIGRATION\.md|DEPLOYMENT\.md|CODEOWNERS|Dockerfile|Makefile|\.env(?:\.example)?|\.nvmrc|\.gitignore|\.dockerignore|\.npmrc|\.prettierrc|\.mcp\.json|package\.json|pnpm-workspace\.yaml|pnpm-lock\.yaml|turbo\.json|render\.yaml|stackhawk\.yml|next\.config\.mjs|tailwind\.config\.ts|postcss\.config\.js|tsconfig(?:\.base)?\.json|docker-compose(?:\.production)?\.yml|ecosystem\.config\.js)$/;

function cleanPathToken(raw) {
  let tok = raw.replace(/^[`'"({+]+/, '').replace(/[`'"\)},;:]+$/, '');
  // Strip outer wrapping brackets "[path]" without breaking Next.js dynamic routes like ".../[id]"
  if (tok.startsWith('[') && !tok.includes('/')) {
    tok = tok.replace(/^\[+/, '').replace(/\]+$/, '');
  } else {
    tok = tok.replace(/^\[+/, '');
    // Strip trailing ']' ONLY when unbalanced (more ']' than '[').
    while (tok.endsWith(']') && (tok.match(/\[/g)?.length ?? 0) < (tok.match(/\]/g)?.length ?? 0)) {
      tok = tok.slice(0, -1);
    }
  }
  return tok.replace(/^\.\//, '');
}

/** Pure POSIX path normalization (no node:path import required, stays browser/pure-lib safe). */
function normalizePosixPath(raw) {
  if (typeof raw !== 'string') return '';
  const slashed = raw.replace(/\\/g, '/').trim();
  if (!slashed || slashed.startsWith('/')) return '';
  const trailingSlash = slashed.endsWith('/');
  const parts = slashed.split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (out.length === 0) return ''; // escapes repo root
      out.pop();
      continue;
    }
    out.push(part);
  }
  if (out.length === 0) return '';
  return trailingSlash ? `${out.join('/')}/` : out.join('/');
}

/**
 * Extract repo-relative path or glob patterns from one plan `files` entry (which may carry prose
 * like "apps/server/src/modules/identity/ (business settings route)" or "a/b.ts (new)").
 * Returns an array of normalized pattern strings, or [] if no path can be extracted.
 */
export function extractWriteSetPatterns(entry) {
  if (typeof entry !== 'string') return [];
  const trimmed = entry.trim();
  if (!trimmed) return [];
  const patterns = [];
  for (const part of trimmed.split(/\s+/)) {
    const tok = cleanPathToken(part);
    if (!tok || /^https?:\/\//i.test(tok)) continue;
    if (tok.split('/').some((seg) => seg === '..')) continue;
    if (REPO_ROOT_PREFIX_RE.test(tok) || TOP_LEVEL_FILE_RE.test(tok)) {
      patterns.push(tok.replace(/\/+/g, '/'));
    }
  }
  return patterns;
}

/** Linear-time O(n) single-segment wildcard matcher (`*` matches 0+ chars within one segment). */
function matchSegmentGlob(seg, pat) {
  // Collapse consecutive '*' within a segment to prevent redundant states.
  const p = pat.replace(/\*+/g, '*');
  let si = 0;
  let pi = 0;
  let starIdx = -1;
  let matchIdx = 0;
  while (si < seg.length) {
    if (pi < p.length && p[pi] === seg[si]) {
      si += 1;
      pi += 1;
    } else if (pi < p.length && p[pi] === '*') {
      starIdx = pi;
      matchIdx = si;
      pi += 1;
    } else if (starIdx !== -1) {
      pi = starIdx + 1;
      matchIdx += 1;
      si = matchIdx;
    } else {
      return false;
    }
  }
  while (pi < p.length && p[pi] === '*') pi += 1;
  return pi === p.length;
}

/** Linear-time segment-level glob matcher supporting `**` (0+ segments) and `*` (within 1 segment). */
function matchPathGlob(normFile, pattern) {
  const fileSegs = normFile.split('/');
  const rawPatSegs = pattern.split('/');
  // Collapse adjacent '**' segments so matching is strictly linear.
  const patSegs = [];
  for (const s of rawPatSegs) {
    if (s === '**' && patSegs.at(-1) === '**') continue;
    patSegs.push(s);
  }
  let fi = 0;
  let pi = 0;
  let starSeg = -1;
  let matchFi = 0;
  while (fi < fileSegs.length) {
    if (pi < patSegs.length && patSegs[pi] === '**') {
      starSeg = pi;
      matchFi = fi;
      pi += 1;
    } else if (pi < patSegs.length && matchSegmentGlob(fileSegs[fi], patSegs[pi])) {
      fi += 1;
      pi += 1;
    } else if (starSeg !== -1) {
      pi = starSeg + 1;
      matchFi += 1;
      fi = matchFi;
    } else {
      return false;
    }
  }
  while (pi < patSegs.length && patSegs[pi] === '**') pi += 1;
  return pi === patSegs.length;
}

function matchSinglePattern(normFile, pattern) {
  const p = pattern.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!p) return false;
  // Directory prefix (explicit trailing slash)
  if (p.endsWith('/')) {
    return normFile.startsWith(p);
  }
  // Wildcards: linear-time segment matcher ('*' within 1 segment, '**' across 0+ segments)
  if (p.includes('*')) {
    return matchPathGlob(normFile, p);
  }
  // Exact file match
  if (normFile === p) return true;
  // Directory path without trailing slash (no file extension in last segment, e.g. "apps/server/src/modules/ai" or ".../[id]")
  const lastSeg = p.split('/').at(-1) ?? '';
  if (p.includes('/') && !lastSeg.includes('.')) {
    return normFile.startsWith(`${p}/`);
  }
  return false;
}

/**
 * Pure check of whether repo-relative `filePath` falls inside a packet's `files` write set.
 * Returns `{ inside, checkable }`. If `files` is empty or ANY entry yields no extractable path
 * (prose-only entry), returns `{ inside: false, checkable: false }`.
 */
export function writeSetMatch(filePath, files) {
  if (!Array.isArray(files) || files.length === 0) {
    return { inside: false, checkable: false };
  }
  const allPatterns = [];
  for (const entry of files) {
    const pats = extractWriteSetPatterns(entry);
    if (pats.length === 0) {
      return { inside: false, checkable: false };
    }
    allPatterns.push(...pats);
  }
  const norm = normalizePosixPath(filePath);
  if (!norm) return { inside: false, checkable: true };
  const inside = allPatterns.some((pat) => matchSinglePattern(norm, pat));
  return { inside, checkable: true };
}

