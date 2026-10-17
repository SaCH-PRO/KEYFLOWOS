import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Offline transport-shape check only. Never sends comments or requests.
const [rootArg, commentsArg, bodyArg, outputArg] = process.argv.slice(2);
assert(rootArg && commentsArg && bodyArg && outputArg,
  'Usage: node check-progress-shape.mjs <pinned-main> <comments.json> <body.md> <result.json>');
const root = path.resolve(rootArg);
const { collectAuthority, AUTHORIZED_AUTHORS } = await import(pathToFileURL(path.join(root, 'scripts/agent-control/lib/control-envelope.mjs')));
const { selectDirective } = await import(pathToFileURL(path.join(root, 'scripts/agent-control/select-directive.mjs')));
const snapshot = JSON.parse(fs.readFileSync(commentsArg, 'utf8'));
const comments = Array.isArray(snapshot) ? snapshot : snapshot.comments;
assert(Array.isArray(comments));
const body = fs.readFileSync(bodyArg, 'utf8');
assert(body.startsWith('message_id: CG-PROGRESS-P0-SAFETY-REVIEW-20261017-001\nmessage_type: PROGRESS\n'));
const latestTime = Math.max(...comments.map(c => Date.parse(c.created_at)));
const timestamp = new Date(latestTime + 1000).toISOString();
const fixture = { id: 999999999999, body, user: { login: 'SaCH-PRO' }, created_at: timestamp, updated_at: timestamp };

function inspect(extra) {
  const all = extra ? [...comments, extra] : comments;
  const authority = collectAuthority(all);
  return {
    verified: authority.verified,
    candidates: authority.candidates.length,
    newest: authority.newest?.message_id,
    selected: selectDirective({ comments: all, processed: [], authors: AUTHORIZED_AUTHORS }).output.selected?.message_id,
  };
}

const original = inspect(null);
const progress = inspect(fixture);
const review = inspect({ ...fixture, body: body.replace('message_type: PROGRESS', 'message_type: REVIEW') });
assert.equal(original.selected, 'CG-DIR-HANDOFF-UI-001', 'The live handoff changed; re-assess instead of assuming H1 is still selected.');
assert.deepEqual(progress, original, 'PROGRESS must preserve both authority and directive selection.');
assert.notEqual(review.selected, original.selected, 'Characterized REVIEW-displacement behavior changed; re-assess the transport decision.');

const result = {
  purpose: 'OFFLINE_MESSAGE_SHAPE_CHECK_NOT_AUTHORITY',
  source_main: '98ee0202499ba87fa4ee13d58a2a9075016225bd',
  comments_count: comments.length,
  body_sha256: crypto.createHash('sha256').update(body).digest('hex'),
  original, progress, hypothetical_review: review,
  progress_preserves_h1: true,
  hypothetical_review_displaces_h1: true,
  outbound_requests: 0,
};
fs.writeFileSync(outputArg, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
