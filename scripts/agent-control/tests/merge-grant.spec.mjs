/**
 * MERGE-GRANT (KF-META-MERGE-AUTHORITY-001; CG-DIR-F9-001; finding F9).
 *
 * Every denial asserts its own reason, and every family has a referent: the
 * same collection without the defect grants. A test that only checked
 * `granted === false` would pass for a predicate that denies everything.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateMergeGrant, sameGrant, GRANT_REASONS } from '../lib/merge-grant.mjs';
import { collectAuthority } from '../lib/control-envelope.mjs';
import { readEffect } from '../lib/authority-effects.mjs';
import {
  REPO, HEAD, BASE, SEMANTIC, target, body, grantFields, comment, grantComment, followUp, holdComment, claudeNote,
} from './helpers/merge-grant-fixture.mjs';

const OTHER = 'd'.repeat(40);
const verdict = (comments, t = target()) => evaluateMergeGrant(comments, t);
const reasonOf = (comments, t) => verdict(comments, t).reason;

test('referent: one exact-head grant for this PR grants, bound to every target field', () => {
  const g = grantComment();
  const v = verdict([g]);
  assert.equal(v.granted, true);
  assert.equal(v.reason, GRANT_REASONS.GRANTED);
  assert.equal(v.grant.comment_id, g.id);
  assert.equal(v.grant.effect, 'NO_STATE_CHANGE');
  assert.deepEqual(v.grant.binding, {
    repository: REPO, pr_number: 87, packet_id: 'KF-X-001', implementation_branch: 'impl/x',
    source_head: SEMANTIC, pr_head: HEAD, base_sha: BASE,
  });
});

// ------------------------------------------------------------- absent / not a grant

test('NC grant absent: no comments, unrelated authority or only non-authority messages never grant', () => {
  assert.equal(reasonOf([]), GRANT_REASONS.ABSENT);
  const other = target({ packet_id: 'KF-OTHER-009', pr_number: 41, implementation_branch: 'impl/other' });
  assert.equal(reasonOf([grantComment({}, {}, other)]), GRANT_REASONS.ABSENT, 'a grant for another PR names nothing here');
  assert.equal(reasonOf([claudeNote('RETURN'), claudeNote('ACK')]), GRANT_REASONS.ABSENT, 'a builder message is not authority');
  // The builder can write merge_authority: true in its own words; it is not ChatGPT.
  assert.equal(reasonOf([comment(body(grantFields({ sender: 'claude' })))]), GRANT_REASONS.ABSENT);
});

test('NC grant false/null/malformed: merge_authority other than exactly true is not a grant', () => {
  for (const value of ['false', null, 'TRUE', 'yes', '1', '"true "']) {
    const v = verdict([grantComment({ merge_authority: value })]);
    assert.equal(v.reason, GRANT_REASONS.NOT_A_GRANT, String(value));
    assert.match(v.detail.problems.join(' '), /merge_authority/, String(value));
  }
  const v = verdict([grantComment({ merge_authority: undefined })]);
  assert.equal(v.reason, GRANT_REASONS.NOT_A_GRANT, 'absent');
});

test('NC ACCEPT_FOR_ADMISSION is acceptance of a record, never the merge decision', () => {
  const v = verdict([grantComment({ review_status: 'ACCEPT_FOR_ADMISSION' })]);
  assert.equal(v.reason, GRANT_REASONS.NOT_A_GRANT);
  assert.match(v.detail.problems.join(' '), /review_status \(ACCEPT_FOR_ADMISSION is not READY_TO_MERGE\)/);
  // Nor is a semantic PASS without the grant fields, as the KF155-006 review shape.
  const pass = comment(body({ ...grantFields({ review_status: 'SEMANTIC_PASS', merge_authority: 'false' }), semantic_review_outcome: 'PASS', reviewed_head: SEMANTIC }));
  assert.equal(reasonOf([pass]), GRANT_REASONS.NOT_A_GRANT);
});

test('NC ACCEPT_FOR_ADMISSION followed by a distinct later grant: only the later grant counts', () => {
  const accepted = grantComment({ message_id: 'CG-REVIEW-ACCEPT-001', review_status: 'ACCEPT_FOR_ADMISSION', merge_authority: 'false' });
  assert.equal(reasonOf([accepted]), GRANT_REASONS.NOT_A_GRANT);
  const later = grantComment({ message_id: 'CG-REVIEW-GRANT-002' });
  const v = verdict([accepted, later]);
  assert.equal(v.granted, true);
  assert.equal(v.grant.message_id, 'CG-REVIEW-GRANT-002');
});

test('NC NO_STATE_CHANGE alone is not a grant; an unreadable or wrong effect is not either', () => {
  // NO_STATE_CHANGE without merge_authority/review_status is an ordinary review.
  const plain = grantComment({ merge_authority: undefined, review_status: undefined });
  assert.equal(reasonOf([plain]), GRANT_REASONS.NOT_A_GRANT);
  for (const effect of [undefined, 'CHECKPOINT', 'PACKET_CORRECTION', 'GRANT_MERGE', 'BOUNDED_CORRECTION']) {
    const v = verdict([grantComment({ control_effect: effect })]);
    assert.equal(v.reason, GRANT_REASONS.NOT_A_GRANT, String(effect));
    assert.match(v.detail.problems.join(' '), /control_effect/, String(effect));
  }
  // An application grant (PACKET_ADMISSION) is a grant.
  const app = verdict([grantComment({ control_effect: 'PACKET_ADMISSION' })]);
  assert.equal(app.granted, true);
  assert.equal(app.grant.effect, 'PACKET_ADMISSION');
});

test('NC a grant typed as a DIRECTIVE, or touching production, is not a grant', () => {
  assert.equal(reasonOf([grantComment({ message_type: 'DIRECTIVE' })]), GRANT_REASONS.NOT_A_GRANT);
  assert.equal(reasonOf([grantComment({ production_touched: 'true' })]), GRANT_REASONS.NOT_A_GRANT);
});

// ------------------------------------------------------------------- forged / edited

test('NC forged: a perfect grant from an account outside the allowlist is not authority', () => {
  assert.equal(reasonOf([grantComment({}, { author: 'mallory' })]), GRANT_REASONS.ABSENT);
  // ...and it cannot void a real grant either.
  const v = verdict([grantComment(), followUp({}, { author: 'mallory' })]);
  assert.equal(v.granted, true);
});

test('NC edited: any edited or edit-unknown allowlisted comment makes the authority unverifiable', () => {
  const g = grantComment();
  const edited = { ...g, updated_at: '2026-10-18T00:00:00Z' };
  const v = verdict([edited]);
  assert.equal(v.reason, GRANT_REASONS.AUTHORITY_UNVERIFIED);
  assert.equal(v.detail.code, 'AUTHORITY_EDITED');
  const { updated_at, ...unknown } = grantComment();
  assert.equal(verdict([unknown]).detail.code, 'AUTHORITY_UNVERIFIABLE');
  // An edit anywhere on #80 by an allowlisted author, not only on the grant.
  const note = claudeNote();
  assert.equal(reasonOf([grantComment(), { ...note, updated_at: '2026-10-18T00:00:00Z' }]), GRANT_REASONS.AUTHORITY_UNVERIFIED);
});

test('NC incomplete evidence: an unobserved collection or unordered authority never grants', () => {
  assert.equal(reasonOf(null), GRANT_REASONS.AUTHORITY_UNVERIFIED);
  assert.equal(reasonOf(undefined), GRANT_REASONS.AUTHORITY_UNVERIFIED);
  const g = grantComment();
  assert.equal(verdict([{ ...g, created_at: 'not a time', updated_at: 'not a time' }]).detail.code, 'AUTHORITY_ORDER_AMBIGUOUS');
  assert.equal(verdict([g, { ...grantComment(), id: g.id }]).detail.code, 'AUTHORITY_ORDER_AMBIGUOUS');
});

test('NC provenance: a grant whose URL is not on the target repository control issue does not grant', () => {
  const v = verdict([grantComment({}, { repo: 'someone/else' })]);
  assert.equal(v.reason, GRANT_REASONS.PROVENANCE);
  assert.equal(reasonOf([grantComment({}, { url: null, html_url: null })]), GRANT_REASONS.PROVENANCE);
  // A repository field, when present, must name the target too.
  assert.equal(reasonOf([grantComment({ repository: 'someone/else' })]), GRANT_REASONS.BINDING_MISMATCH);
  assert.equal(verdict([grantComment({ repository: REPO })]).granted, true);
});

// --------------------------------------------------------------------------- binding

test('NC binding: a grant for another repository, PR, packet, branch, semantic head, final head or base never grants', () => {
  const cases = {
    pr_number: 88,
    packet_id: 'KF-X-002',
    implementation_branch: 'impl/x-2',
    source_head: OTHER,
    pr_head: OTHER,
    source_main: OTHER,
  };
  for (const [key, wrong] of Object.entries(cases)) {
    // The grant still names the target by the other identity fields, so it is about this PR.
    const v = verdict([grantComment({ [key]: wrong })]);
    assert.equal(v.reason, GRANT_REASONS.BINDING_MISMATCH, key);
    assert.deepEqual(v.detail.problems.map((p) => p.field), [key], key);
  }
  // A binding field left out binds nothing (the envelope stays valid: source_main|source_head needs one).
  for (const key of ['source_head', 'pr_head', 'source_main', 'pr_number']) {
    const v = verdict([grantComment({ [key]: undefined })]);
    assert.equal(v.reason, GRANT_REASONS.BINDING_MISMATCH, key);
    assert.deepEqual(v.detail.problems, [{ field: key, expected: key === 'source_main' ? BASE : target()[key === 'pr_number' ? 'pr_number' : key].toString(), found: null }], key);
  }
  // Exact text: case, abbreviation and whitespace are other values.
  for (const wrong of [HEAD.toUpperCase(), HEAD.slice(0, 7), `${HEAD} `]) {
    assert.equal(reasonOf([grantComment({ pr_head: `"${wrong}"` })]), GRANT_REASONS.BINDING_MISMATCH, wrong);
  }
});

test('NC newly moved head or base: a grant for the previous head or base is stale', () => {
  const g = grantComment();
  assert.equal(reasonOf([g], target({ pr_head: OTHER })), GRANT_REASONS.BINDING_MISMATCH, 'head moved');
  assert.equal(reasonOf([g], target({ base_sha: OTHER })), GRANT_REASONS.BINDING_MISMATCH, 'base moved');
  assert.equal(reasonOf([g], target({ source_head: OTHER })), GRANT_REASONS.BINDING_MISMATCH, 'semantic head moved');
  // A new grant at the moved head restores it.
  assert.equal(verdict([g, grantComment({ pr_head: OTHER })], target({ pr_head: OTHER })).granted, true);
});

test('NC incomplete target: the predicate never grants for a target it cannot bind', () => {
  for (const [key, value] of [['repository', ''], ['pr_number', null], ['packet_id', ' '], ['implementation_branch', undefined], ['source_head', 'abc'], ['pr_head', null], ['base_sha', '']]) {
    const v = verdict([grantComment()], target({ [key]: value }));
    assert.equal(v.reason, GRANT_REASONS.TARGET_INCOMPLETE, key);
    assert.ok(v.detail.includes(key), key);
  }
});

// ------------------------------------------------------- order, revocation and holds

test('NC revoked: a later valid message about the target supersedes the grant, whatever it says', () => {
  const g = grantComment();
  const revocations = [
    followUp(),
    followUp({ review_status: 'READY_TO_MERGE', merge_authority: 'false' }),
    followUp({ message_type: 'DIRECTIVE', control_effect: 'NO_STATE_CHANGE', review_status: undefined }),
    holdComment('HOLD', 'KF-X-001'),
    // About the target by PR number alone, or by branch alone.
    followUp({ packet_id: 'KF-ELSE', implementation_branch: 'impl/else' }),
    followUp({ packet_id: 'KF-ELSE', pr_number: 999 }),
  ];
  for (const later of revocations) {
    const v = verdict([g, later]);
    assert.equal(v.reason, GRANT_REASONS.SUPERSEDED, later.body.split('\n')[1]);
    assert.equal(v.detail.grant.comment_id, g.id);
  }
});

test('NC unrelated authority after the grant does not revoke it, so another active packet is untouched', () => {
  const g = grantComment();
  const unrelated = target({ packet_id: 'KF-EXEC-AUTH-FAIL-CLOSED-001', pr_number: 155, implementation_branch: 'impl/kf-exec-auth-fail-closed-001' });
  const v = verdict([g, followUp({}, {}, unrelated), holdComment('HOLD', 'KF-EXEC-AUTH-FAIL-CLOSED-001'), claudeNote('RETURN')]);
  assert.equal(v.granted, true);
  assert.equal(v.grant.comment_id, g.id);
});

test('NC stale: an older grant followed by a newer non-grant is superseded, not revived', () => {
  const first = grantComment({ message_id: 'G1' });
  const changes = followUp({ message_id: 'R2' });
  const v = verdict([first, changes]);
  assert.equal(v.reason, GRANT_REASONS.SUPERSEDED);
  assert.equal(v.detail.superseded_by.message_id, 'R2');
});

test('NC ambiguous: a malformed authority candidate after the grant that is or may be about the target denies', () => {
  const g = grantComment();
  // A repeated key makes the message malformed; it still names this packet.
  const malformedAbout = comment(body({ ...grantFields({ message_id: 'M1', merge_authority: 'false' }), health: ['GREEN', 'RED'] }));
  // A malformed HOLD with no packet id names nothing readable, so it may be this one.
  const malformedUnknown = comment(body({ message_id: 'M2', message_type: 'HOLD', sender: 'chatgpt', source_main: BASE, implementation_branch: 'null', state: 'BLOCKED', health: 'YELLOW', scope_changed: 'false', production_touched: 'false' }));
  for (const bad of [malformedAbout, malformedUnknown]) {
    assert.equal(reasonOf([g, bad]), GRANT_REASONS.AMBIGUOUS);
  }
  // A malformed candidate that plainly names another packet, PR and branch does not.
  const elsewhere = comment(body({ ...grantFields({ message_id: 'M3', packet_id: 'KF-ELSE', pr_number: 999, implementation_branch: 'impl/else' }), health: ['GREEN', 'RED'] }));
  assert.equal(verdict([g, elsewhere]).granted, true);
  // A malformed candidate before the grant is superseded by it.
  assert.equal(verdict([malformedAbout, grantComment()]).granted, true);
});

test('NC hold: a valid HOLD on the target packet with no later RESUME denies, before or after the grant', () => {
  const hold = holdComment('HOLD', 'KF-X-001');
  const before = verdict([hold, grantComment()]);
  assert.equal(before.reason, GRANT_REASONS.HOLD_ACTIVE);
  assert.equal(before.detail.comment_id, hold.id);
  assert.equal(reasonOf([grantComment(), holdComment('HOLD', 'KF-X-001')]), GRANT_REASONS.SUPERSEDED);
  // Referent: RESUME then a grant.
  assert.equal(verdict([holdComment('HOLD', 'KF-X-001'), holdComment('RESUME', 'KF-X-001'), grantComment()]).granted, true);
  // A grant then a HOLD then a RESUME still needs a new grant: the RESUME is newer.
  assert.equal(reasonOf([grantComment(), holdComment('HOLD', 'KF-X-001'), holdComment('RESUME', 'KF-X-001')]), GRANT_REASONS.SUPERSEDED);
});

// PR 181 review 5560243413 P1: an envelope-valid RESUME is not a release unless
// its effect is a valid HOLD_CLEAR, as readEffect() reads it.
const invalidReleases = [
  ['missing effect', (b) => b.replace('control_effect: HOLD_CLEAR\n', ''), 'CONTROL_EFFECT_MISSING'],
  ['wrong effect', (b) => b.replace('control_effect: HOLD_CLEAR', 'control_effect: NO_STATE_CHANGE'), 'CONTROL_EFFECT_TYPE_MISMATCH'],
  ['unknown effect', (b) => b.replace('control_effect: HOLD_CLEAR', 'control_effect: RELEASE_ALL'), 'CONTROL_EFFECT_UNKNOWN'],
  ['production touched', (b) => b.replace('production_touched: false', 'production_touched: true'), 'CONTROL_EFFECT_PRODUCTION_TOUCHED'],
  ['invalid health', (b) => b.replace('health: YELLOW', 'health: AMBER'), 'CONTROL_EFFECT_HEALTH_INVALID'],
];

test('NC hold release: a RESUME whose effect is not a valid HOLD_CLEAR leaves the target hold active', () => {
  for (const [name, change, code] of invalidReleases) {
    const hold = holdComment('HOLD', 'KF-X-001');
    const resume = holdComment('RESUME', 'KF-X-001');
    resume.body = change(resume.body);
    const comments = [hold, resume, grantComment()];
    // The envelope is valid, so collectAuthority keeps it; only the effect is wrong.
    const entry = collectAuthority(comments).candidates.find((c) => c.comment_id === resume.id);
    assert.deepEqual(entry.problems, [], name);
    assert.equal(readEffect(entry).code, code, name);
    const v = verdict(comments);
    assert.equal(v.reason, GRANT_REASONS.HOLD_ACTIVE, name);
    assert.equal(v.detail.comment_id, hold.id, name);
  }
  // Referent: the same sequence with a valid HOLD_CLEAR grants.
  assert.equal(verdict([holdComment('HOLD', 'KF-X-001'), holdComment('RESUME', 'KF-X-001'), grantComment()]).granted, true);
  // An invalid release for another packet neither blocks nor helps this one.
  const other = holdComment('RESUME', 'KF-OTHER-001');
  other.body = other.body.replace('control_effect: HOLD_CLEAR', 'control_effect: NO_STATE_CHANGE');
  assert.equal(verdict([holdComment('HOLD', 'KF-OTHER-001'), other, grantComment()]).granted, true);
});

test('the PR 159 shape: a bounded meta grant with NO_STATE_CHANGE grants for its own PR only', () => {
  const meta = target({
    pr_number: 159,
    packet_id: 'KF-META-AUTHORITY-EFFECT-COMPAT-001',
    implementation_branch: 'impl/kf-meta-authority-effect-compat-001',
    source_head: 'f14adec5251aa3a69132c336efcb1819fd5b6a95',
    pr_head: '3925ba0abf1bed6e72e76da8d59846ca67caa68c',
    base_sha: '7d2619c771cd008f21bae9c60ca348e3deaa07cd',
  });
  const grant = grantComment({ message_id: 'CG-REVIEW-KF159-EXACT-HEAD-MERGE-AUTH-001', state: 'READY_TO_MERGE', health: 'GREEN' }, {}, meta);
  // The application packet's own correction stays where it is and does not interfere.
  const app = target({ packet_id: 'KF-EXEC-AUTH-FAIL-CLOSED-001', pr_number: 155, implementation_branch: 'impl/kf-exec-auth-fail-closed-001' });
  const appCorrection = followUp({ control_effect: 'PACKET_CORRECTION', state: 'FIXING_PROOF_FAILURES' }, {}, app);
  const v = verdict([appCorrection, grant], meta);
  assert.equal(v.granted, true);
  assert.equal(v.grant.message_id, 'CG-REVIEW-KF159-EXACT-HEAD-MERGE-AUTH-001');
  // And it is no grant for the application PR.
  assert.equal(reasonOf([appCorrection, grant], target({ ...app, source_head: SEMANTIC })), GRANT_REASONS.NOT_A_GRANT);
});

test('sameGrant compares the grant identity and its binding, and nothing else', () => {
  const a = verdict([grantComment()]).grant;
  assert.equal(sameGrant(a, structuredClone(a)), true);
  assert.equal(sameGrant(a, { ...a, comment_id: a.comment_id + 1 }), false);
  assert.equal(sameGrant(a, { ...a, binding: { ...a.binding, pr_head: OTHER } }), false);
  assert.equal(sameGrant(a, null), false);
  assert.equal(sameGrant(null, null), false);
});
