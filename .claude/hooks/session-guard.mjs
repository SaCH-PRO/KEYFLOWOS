#!/usr/bin/env node
/**
 * Cross-session guard for KEYFLOWOS.
 *
 * This repository is routinely worked on by a dozen concurrent Claude sessions.
 * On 2026-08-23 one session's finished, tested work — an edit plus a new test
 * file — silently vanished mid-run because another session ran a repo-global
 * git command. Nothing warned either side, and the loss was only noticed
 * because a test suite started failing for an impossible reason.
 *
 * Two harm modes cause nearly all of it:
 *
 *   1. Repo-global destructive git. `git stash`, `git checkout -- .`,
 *      `git clean -fd`, `git reset --hard` act on the WHOLE tree. They cannot
 *      see that half the dirty files belong to someone else. A scoped
 *      alternative always exists, so this guard refuses the unscoped form
 *      while the tree is dirty and names the scoped command to use instead.
 *
 *   2. Concurrent edits to one file. Last writer wins, silently. Claims here
 *      are recorded AUTOMATICALLY on write — a protocol that depends on
 *      sessions remembering to announce themselves is a protocol that fails,
 *      so nothing needs to be declared.
 *
 * Design rules:
 *   - FAIL OPEN. A coordination guard that breaks the tool gets switched off,
 *     and a switched-off guard protects nothing. Every failure path allows the
 *     operation and says why on stderr.
 *   - "ask", not "deny", wherever the operation is sometimes legitimate. A
 *     hard block on ordinary work trains people to disable the whole system.
 *   - Escape hatch in the command itself: prefix any command with
 *     KF_SESSION_GUARD=off to bypass. Explicit, greppable, and needs no config
 *     change.
 *
 * Usage:  node .claude/hooks/session-guard.mjs <bash|edit|start|end>
 * Input:  hook JSON on stdin.  Output: hook JSON on stdout.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, renameSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = resolve(new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const REG_DIR = join(REPO, '.claude', 'coordination', 'sessions');

/** A session that has not been seen for this long is treated as gone. */
const SESSION_STALE_MS = 45 * 60 * 1000;
/** A file claim older than this no longer blocks anyone. */
const CLAIM_TTL_MS = 30 * 60 * 1000;

const mode = process.argv[2];

/* ------------------------------------------------------------------ */
/* output helpers                                                      */
/* ------------------------------------------------------------------ */

function emit(obj) {
  process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

function allow() {
  emit({});
}

/** `ask` surfaces the reason to the user and lets them decide. */
function ask(reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  });
}

function deny(reason) {
  emit({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  });
}

/* ------------------------------------------------------------------ */
/* registry                                                            */
/* ------------------------------------------------------------------ */

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    return {};
  }
}

function sessionFile(id) {
  return join(REG_DIR, `${String(id).replace(/[^A-Za-z0-9_-]/g, '_')}.json`);
}

function loadSessions() {
  try {
    mkdirSync(REG_DIR, { recursive: true });
    const now = Date.now();
    const out = [];
    for (const name of readdirSync(REG_DIR)) {
      if (!name.endsWith('.json')) continue;
      const p = join(REG_DIR, name);
      try {
        const rec = JSON.parse(readFileSync(p, 'utf8'));
        const seen = Date.parse(rec.lastSeen || 0) || 0;
        if (now - seen > SESSION_STALE_MS) {
          // Reap: the session is long gone and its claims are meaningless.
          try { unlinkSync(p); } catch { /* another guard may have won the race */ }
          continue;
        }
        out.push(rec);
      } catch { /* a partially written record is not worth failing over */ }
    }
    return out;
  } catch {
    return [];
  }
}

function saveSession(rec) {
  try {
    mkdirSync(REG_DIR, { recursive: true });
    rec.lastSeen = new Date().toISOString();
    // Write-then-rename so a concurrent reader never sees a half file.
    const target = sessionFile(rec.sessionId);
    const tmp = `${target}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(rec, null, 2));
    try {
      renameSync(tmp, target);
    } catch {
      // Windows can refuse a rename over an open file; fall back to a direct write.
      writeFileSync(target, JSON.stringify(rec, null, 2));
      try { unlinkSync(tmp); } catch { /* best effort */ }
    }
  } catch { /* never let bookkeeping break a tool call */ }
}

function loadOrInit(sessionId) {
  try {
    const raw = readFileSync(sessionFile(sessionId), 'utf8');
    const rec = JSON.parse(raw);
    rec.claims = rec.claims || {};
    return rec;
  } catch {
    return {
      sessionId,
      startedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
      label: process.env.CLAUDE_SESSION_LABEL || '',
      claims: {},
    };
  }
}

/** Repo-relative, forward-slashed, lowercased — Windows paths compare badly raw. */
function normPath(p) {
  if (!p) return '';
  try {
    let rel = relative(REPO, resolve(p));
    if (rel.startsWith('..')) rel = resolve(p); // outside the repo: use absolute
    return rel.split(sep).join('/').toLowerCase();
  } catch {
    return String(p).toLowerCase();
  }
}

/* ------------------------------------------------------------------ */
/* git helpers                                                         */
/* ------------------------------------------------------------------ */

function dirtyFiles() {
  try {
    const out = execFileSync('git', ['status', '--porcelain'], {
      cwd: REPO,
      encoding: 'utf8',
      timeout: 5000,
    });
    return out
      .split('\n')
      .filter(Boolean)
      .map((l) => l.slice(3).trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* mode: bash — refuse repo-global destructive git on a dirty tree     */
/* ------------------------------------------------------------------ */

/**
 * Each rule names a command shape that acts on the entire working tree.
 * `scoped` tells the caller the narrow form that does the same job safely.
 */
const DESTRUCTIVE = [
  {
    // `git stash` / `git stash push` / `git stash -u` with no `-- <path>`
    test: (c) => /\bgit\s+stash\b/.test(c) && !/\bgit\s+stash\s+(list|show|apply|pop|drop|clear|branch)\b/.test(c) && !/--\s+\S/.test(c),
    name: 'git stash (whole tree)',
    scoped: 'git stash push -- <your paths>',
  },
  {
    // `git checkout -- .` / `git checkout .` / bare `git checkout --`
    test: (c) => /\bgit\s+checkout\s+(--\s+)?\.(\s|$)/.test(c) || /\bgit\s+checkout\s+--\s*$/.test(c),
    name: 'git checkout -- . (whole tree)',
    scoped: 'git checkout -- <your paths>',
  },
  {
    test: (c) => /\bgit\s+restore\s+(--staged\s+)?(--worktree\s+)?\.(\s|$)/.test(c),
    name: 'git restore . (whole tree)',
    scoped: 'git restore -- <your paths>',
  },
  {
    // `git clean` with a force flag and no pathspec
    test: (c) => /\bgit\s+clean\b/.test(c) && /-[a-z]*f/.test(c) && !/--\s+\S/.test(c) && !/\bgit\s+clean\s+[^-]\S*/.test(c),
    name: 'git clean -f (whole tree, deletes untracked files)',
    scoped: 'git clean -f -- <your paths>',
  },
  {
    test: (c) => /\bgit\s+reset\s+--hard\b/.test(c),
    name: 'git reset --hard (discards all uncommitted work)',
    scoped: 'git restore -- <your paths>, or commit first',
  },
  {
    test: (c) => /\bgit\s+checkout\s+(-f|--force)\b/.test(c),
    name: 'git checkout --force (overwrites local modifications)',
    scoped: 'commit or stash your own paths first',
  },
];

function modeBash(input) {
  const cmd = String(input?.tool_input?.command || '');
  if (!cmd) allow();
  if (/KF_SESSION_GUARD=off/.test(cmd)) allow();

  const rule = DESTRUCTIVE.find((r) => {
    try { return r.test(cmd); } catch { return false; }
  });
  if (!rule) allow();

  const dirty = dirtyFiles();
  if (dirty.length === 0) allow(); // nothing to destroy

  const sessions = loadSessions().filter((s) => s.sessionId !== input.session_id);
  const others = sessions.length;

  const sample = dirty.slice(0, 12).map((f) => `    ${f}`).join('\n');
  const more = dirty.length > 12 ? `\n    ...and ${dirty.length - 12} more` : '';

  deny(
    `BLOCKED by the cross-session guard: ${rule.name}.\n\n` +
      `The working tree has ${dirty.length} uncommitted change(s), and this repo currently has ` +
      `${others} other live Claude session(s) registered. A repo-global git command cannot tell ` +
      `whose work it is destroying — this exact pattern silently deleted a finished, tested change ` +
      `on 2026-08-23.\n\n` +
      `Uncommitted right now:\n${sample}${more}\n\n` +
      `Use the scoped form instead:\n    ${rule.scoped}\n\n` +
      `If you genuinely intend to act on the whole tree, prefix the command with ` +
      `KF_SESSION_GUARD=off — but check with the other sessions first.`,
  );
}

/* ------------------------------------------------------------------ */
/* mode: edit — claim files, warn when another session holds one       */
/* ------------------------------------------------------------------ */

function modeEdit(input) {
  const file = input?.tool_input?.file_path;
  if (!file) allow();
  const key = normPath(file);
  if (!key) allow();
  // The registry is our own bookkeeping; guarding it would deadlock the guard.
  if (key.startsWith('.claude/coordination/')) allow();

  const me = String(input.session_id || 'unknown');
  const now = Date.now();

  // Does another live session hold a fresh claim on this exact file?
  let holder = null;
  for (const s of loadSessions()) {
    if (s.sessionId === me) continue;
    const ts = s.claims?.[key];
    if (!ts) continue;
    if (now - (Date.parse(ts) || 0) > CLAIM_TTL_MS) continue;
    holder = { session: s, at: ts };
    break;
  }

  // Record our own claim either way — this is what makes the system automatic.
  const rec = loadOrInit(me);
  rec.claims[key] = new Date().toISOString();
  // Keep the record small: drop claims that can no longer block anyone.
  for (const [k, v] of Object.entries(rec.claims)) {
    if (now - (Date.parse(v) || 0) > CLAIM_TTL_MS) delete rec.claims[k];
  }
  saveSession(rec);

  if (!holder) allow();

  const mins = Math.max(1, Math.round((now - Date.parse(holder.at)) / 60000));
  const who = holder.session.label
    ? `${holder.session.label} (${holder.session.sessionId.slice(0, 8)})`
    : holder.session.sessionId.slice(0, 8);

  ask(
    `Another live Claude session edited this file ${mins} minute(s) ago:\n` +
      `    ${key}\n` +
      `    held by: ${who}\n\n` +
      `Editing it now can silently overwrite work that session has not finished or committed. ` +
      `Consider messaging it first (ListAgents / SendMessage), or pick a different file.\n\n` +
      `Approve to edit anyway.`,
  );
}

/* ------------------------------------------------------------------ */
/* modes: start / end                                                  */
/* ------------------------------------------------------------------ */

function modeStart(input) {
  const me = String(input.session_id || 'unknown');
  const rec = loadOrInit(me);
  saveSession(rec);

  const others = loadSessions().filter((s) => s.sessionId !== me);
  if (others.length === 0) allow();

  const dirty = dirtyFiles();
  emit({
    systemMessage:
      `Cross-session guard active. ${others.length} other live session(s) registered in this repo; ` +
      `${dirty.length} uncommitted file(s) in the tree. Repo-global git (stash/clean/reset --hard/checkout .) ` +
      `is blocked while the tree is dirty — scope it with "-- <paths>" instead.`,
  });
}

function modeEnd(input) {
  const me = String(input.session_id || 'unknown');
  try { unlinkSync(sessionFile(me)); } catch { /* already gone */ }
  allow();
}

/* ------------------------------------------------------------------ */

try {
  const input = readStdin();
  if (mode === 'bash') modeBash(input);
  else if (mode === 'edit') modeEdit(input);
  else if (mode === 'start') modeStart(input);
  else if (mode === 'end') modeEnd(input);
  else allow();
} catch (err) {
  // Fail open, loudly. A broken guard must never block work.
  process.stderr.write(`[session-guard] failed open: ${err?.message}\n`);
  allow();
}
