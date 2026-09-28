#!/usr/bin/env node
/**
 * The worker's command-authority boundary: decide which control-room message,
 * if any, the local worker may wake Claude for.
 *
 * Anything selected becomes a non-interactive Claude session holding gh and
 * git, so only the authority's own newest message may be selected. The rule
 * is the shared AUTHORITY profile (lib/control-envelope.mjs), the same one
 * reconcile.mjs and event normalization use. select-directive.ps1 is a thin
 * wrapper that keeps the worker's interface; the decision is made only here.
 *
 * Selected only when ALL hold for the NEWEST authority message on #80:
 *   - it comes from an allowlisted GitHub author with sender exactly `chatgpt`
 *     (WORKER-DIRECTIVE-AUTHORITY-001, WORKER-AUTHORITY-PUBLIC-REPO-001);
 *   - its envelope is well formed: no repeated key, no unmatched quote,
 *     message_id and packet_id set and not blank, every envelope key present;
 *   - no comment from an allowlisted author has been edited;
 *   - it is a DIRECTIVE or REVIEW (a newer HOLD or RESUME selects nothing);
 *   - it is not already in the processed cursor.
 * A forged or non-ChatGPT message is listed in `rejected` and never displaces
 * an older real one. A malformed ChatGPT message is authority that cannot be
 * read, so nothing older is selected in its place.
 *
 * Usage:
 *   node select-directive.mjs --comments-file=<gh issue view --json comments>
 *        [--cursor-file=<cursor.json>] --authorized-authors=<login,login>
 * Output: {selected, reason, rejected}
 * Exit 0 on a decision (including "nothing to do"); 2 when the input or the
 * authority record is unreadable.
 */

import fs from 'node:fs';
import { collectAuthority, compareAuthorityOrder, hasDeterministicOrder } from './lib/control-envelope.mjs';

/** Authority types the worker wakes for. */
export const WAKE_TYPES = Object.freeze(['DIRECTIVE', 'REVIEW']);

function decision(selected, reason, rejected = [], code = 0) {
  return { code, output: { selected, reason, rejected } };
}

/**
 * @param {object} input { comments, processed: string[], authors: string[] }
 * @returns {{code: number, output: {selected: object|null, reason: string, rejected: object[]}}}
 */
export function selectDirective({ comments, processed = [], authors = [] }) {
  const authority = collectAuthority(comments, { authors });
  if (!authority.verified) {
    return decision(null, `${String(authority.code).toLowerCase()}:${authority.reason}`, [], 2);
  }

  const decisive = authority.candidates.length ? authority.candidates[authority.candidates.length - 1] : null;
  // Newest first, as the worker logs them; only rejections newer than what decided.
  const rejected = authority.rejections
    .filter((r) => r.message_id !== null)
    .filter((r) => !decisive || !hasDeterministicOrder(r) || compareAuthorityOrder(r, decisive) > 0)
    .reverse()
    .map((r) => ({ message_id: r.message_id, reason: r.reason }));

  if (!decisive) return decision(null, 'no_actionable_message', rejected);

  // A blank id is malformed, so it only ever labels a rejection; name the comment instead.
  const label = decisive.message_id?.trim() ? decisive.message_id : `comment:${decisive.comment_id}`;
  if (decisive.problems.length) {
    return decision(null, `newest_authority_malformed:${label}`, [
      ...rejected,
      { message_id: label, reason: `malformed:${decisive.problems.join('; ')}` },
    ]);
  }
  if (!WAKE_TYPES.includes(decisive.message_type)) {
    return decision(null, `newest_authority_not_actionable:${decisive.message_type}:${label}`, rejected);
  }
  // Case-insensitive, as the PowerShell selector's -contains was.
  const done = processed.map((p) => String(p).toLowerCase());
  if (done.includes(decisive.message_id.toLowerCase())) {
    return decision(null, `newest_already_processed:${decisive.message_id}`, rejected);
  }

  return decision({
    message_id: decisive.message_id,
    message_type: decisive.message_type,
    packet_id: decisive.packet_id,
    // AUTHORITY accepts source_main|source_head, so a head-only message still
    // names its base. The output keeps one field; an explicit source_main wins.
    source_main: decisive.source_main ?? decisive.source_head,
    implementation_branch: decisive.implementation_branch,
    created_at: decisive.created_at,
    url: decisive.url,
    author: decisive.author,
  }, 'selected', rejected);
}

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit === undefined ? null : hit.slice(prefix.length);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

function main() {
  const commentsFile = arg('comments-file');
  let comments;
  try {
    comments = readJson(commentsFile).comments;
    if (!Array.isArray(comments)) throw new Error('no comments array');
  } catch {
    return decision(null, 'comments_unreadable', [], 2);
  }

  let processed = [];
  const cursorFile = arg('cursor-file');
  if (cursorFile && fs.existsSync(cursorFile)) {
    try {
      const ids = readJson(cursorFile).processed_message_ids;
      if (ids) processed = Array.isArray(ids) ? ids : [ids];
    } catch {
      // An unreadable cursor must not be read as "nothing processed": that
      // would replay every directive on the channel.
      return decision(null, 'cursor_unreadable', [], 2);
    }
  }

  const authors = String(arg('authorized-authors') || '').split(',').map((a) => a.trim()).filter(Boolean);
  return selectDirective({ comments, processed, authors });
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('select-directive.mjs');
if (invokedDirectly) {
  let result;
  try {
    result = main();
  } catch (error) {
    result = decision(null, `selector_failed:${error.message}`, [], 2);
  }
  process.stdout.write(JSON.stringify(result.output) + '\n');
  process.exitCode = result.code;
}

export default { selectDirective, WAKE_TYPES };
