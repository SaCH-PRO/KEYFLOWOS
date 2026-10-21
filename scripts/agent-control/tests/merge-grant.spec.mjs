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
  directiveComment, realPlanComment, PLAN_5826799265_BODY,
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
  ['programme field', (b) => b.replace('control_effect: HOLD_CLEAR\n', 'control_effect: HOLD_CLEAR\nprogramme_action: ACTIVATE\n'), 'CONTROL_EFFECT_PROGRAMME_NOT_FOLDABLE'],
  ['hold effect on a RESUME', (b) => b.replace('control_effect: HOLD_CLEAR', 'control_effect: HOLD_SET'), 'CONTROL_EFFECT_TYPE_MISMATCH'],
  ['production untouched not stated', (b) => b.replace('production_touched: false', 'production_touched: null'), 'CONTROL_EFFECT_PRODUCTION_TOUCHED'],
  // COV-HOLD-05 to 08 (CC-PROGRESS-F9-PROBE-001): the release reads each value exactly.
  ['effect in lower case', (b) => b.replace('control_effect: HOLD_CLEAR', 'control_effect: hold_clear'), 'CONTROL_EFFECT_UNKNOWN'],
  ['health in lower case', (b) => b.replace('health: YELLOW', 'health: yellow'), 'CONTROL_EFFECT_HEALTH_INVALID'],
  ['programme key', (b) => b.replace('control_effect: HOLD_CLEAR\n', 'control_effect: HOLD_CLEAR\nprogramme: KEYFLOWOS_PLATFORM_CONVERGENCE\n'), 'CONTROL_EFFECT_PROGRAMME_NOT_FOLDABLE'],
  ['production untouched capitalised', (b) => b.replace('production_touched: false', 'production_touched: False'), 'CONTROL_EFFECT_PRODUCTION_TOUCHED'],
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

// A release is bound to the held packet and to #80 order, as the fold in
// authority-effects.mjs binds it: a HOLD_CLEAR for another packet, or one older
// than the HOLD it would clear, releases nothing. Every fixture call is newer
// than the last, so each case is built in the #80 order it asserts.
test('NC hold release binding: a valid HOLD_CLEAR for another packet leaves the target hold active', () => {
  const hold = holdComment('HOLD', 'KF-X-001');
  const elsewhere = holdComment('RESUME', 'KF-OTHER-001');
  const comments = [hold, elsewhere, grantComment()];
  // The release is valid in every respect but its packet.
  const entry = collectAuthority(comments).candidates.find((c) => c.comment_id === elsewhere.id);
  assert.deepEqual(entry.problems, []);
  const read = readEffect(entry);
  assert.equal(read.ok, true);
  assert.equal(read.effect, 'HOLD_CLEAR');
  assert.equal(read.packet_id, 'KF-OTHER-001');
  assert.ok(Date.parse(hold.created_at) < Date.parse(elsewhere.created_at), 'the RESUME follows the HOLD');
  const v = verdict(comments);
  assert.equal(v.reason, GRANT_REASONS.HOLD_ACTIVE);
  assert.equal(v.detail.comment_id, hold.id);
  // Naming the target's PR and branch does not make another packet's
  // HOLD_CLEAR a release of this one: a release is keyed by its packet.
  const held = holdComment('HOLD', 'KF-X-001');
  const byReference = holdComment('RESUME', 'KF-OTHER-001', {}, { pr_number: 87, implementation_branch: 'impl/x' });
  const referenced = [held, byReference, grantComment()];
  const read2 = readEffect(collectAuthority(referenced).candidates.find((c) => c.comment_id === byReference.id));
  assert.equal(read2.ok, true);
  assert.equal(read2.effect, 'HOLD_CLEAR');
  assert.equal(read2.pr_number, '87');
  const v2 = verdict(referenced);
  assert.equal(v2.reason, GRANT_REASONS.HOLD_ACTIVE, 'a release that names the target PR and branch under another packet');
  assert.equal(v2.detail.comment_id, held.id);
  // Referent: the same release naming the held packet grants.
  assert.equal(verdict([holdComment('HOLD', 'KF-X-001'), holdComment('RESUME', 'KF-X-001'), grantComment()]).granted, true);
});

test('NC hold release exact packet: a HOLD_CLEAR whose packet differs in case or whitespace releases nothing', () => {
  for (const written of ['kf-x-001', 'KF-x-001', '"KF-X-001 "', '" KF-X-001"', '"KF-X-001\\t"']) {
    const hold = holdComment('HOLD', 'KF-X-001');
    const resume = holdComment('RESUME', 'KF-X-001', {}, { packet_id: written });
    const comments = [hold, resume, grantComment()];
    const read = readEffect(collectAuthority(comments).candidates.find((c) => c.comment_id === resume.id));
    assert.equal(read.ok, true, written);
    assert.notEqual(read.packet_id, 'KF-X-001', written);
    const v = verdict(comments);
    assert.equal(v.reason, GRANT_REASONS.HOLD_ACTIVE, written);
    assert.equal(v.detail.comment_id, hold.id, written);
  }
  // Referent: the exact id releases.
  assert.equal(verdict([holdComment('HOLD', 'KF-X-001'), holdComment('RESUME', 'KF-X-001', {}, { packet_id: 'KF-X-001' }), grantComment()]).granted, true);
});

test('hold release health (Q1): a blank health is absent and releases; a present health outside the vocabulary does not', () => {
  const blank = holdComment('RESUME', 'KF-X-001', {}, { health: null });
  assert.match(blank.body, /^health: $/m);
  const hold = holdComment('HOLD', 'KF-X-001');
  const release = holdComment('RESUME', 'KF-X-001', {}, { health: null });
  const comments = [hold, release, grantComment()];
  const entry = collectAuthority(comments).candidates.find((c) => c.comment_id === release.id);
  assert.deepEqual(entry.problems, []);
  const read = readEffect(entry);
  assert.equal(read.ok, true);
  assert.equal(read.health, null);
  assert.equal(verdict(comments).granted, true);
  // Distinguishing negative: the same release with a present, invalid health.
  const hold2 = holdComment('HOLD', 'KF-X-001');
  const amber = holdComment('RESUME', 'KF-X-001', {}, { health: 'AMBER' });
  const v = verdict([hold2, amber, grantComment()]);
  assert.equal(v.reason, GRANT_REASONS.HOLD_ACTIVE);
  assert.equal(v.detail.comment_id, hold2.id);
});

test('hold release provenance (Q4): a body repository field or URL is not a RESUME release condition, as in the fold', () => {
  const variants = [
    ['repository field naming another repository', { repository: 'someone/else' }, ''],
    ['repository field naming the target', { repository: REPO }, ''],
    ['a URL in the body', {}, 'Posted from https://github.com/someone/else/issues/80#issuecomment-1'],
  ];
  for (const [name, fields, prose] of variants) {
    const hold = holdComment('HOLD', 'KF-X-001');
    const release = holdComment('RESUME', 'KF-X-001', {}, fields);
    if (prose) release.body += `\n${prose}\n`;
    assert.equal(verdict([hold, release, grantComment()]).granted, true, name);
  }
  // The RESUME still has to be valid authority from an allowlisted account.
  const hold = holdComment('HOLD', 'KF-X-001');
  const forged = holdComment('RESUME', 'KF-X-001', { author: 'mallory' }, { repository: REPO });
  assert.equal(reasonOf([hold, forged, grantComment()]), GRANT_REASONS.HOLD_ACTIVE);
});

// CG-REV-F9-003 (F9-H1, Option A): holds are read over every candidate,
// malformed ones included, so a malformed HOLD before the grant is not
// superseded by it.
const malformedHolds = [
  ['scope_changed omitted', { scope_changed: undefined }],
  ['health repeated', { health: ['YELLOW', 'RED'] }],
  ['packet repeated with the target first', { packet_id: ['KF-X-001', 'KF-OTHER-001'] }],
];

test('NC malformed hold: a malformed HOLD on the target before the grant holds it until a later valid HOLD_CLEAR', () => {
  for (const [name, fields] of malformedHolds) {
    const hold = holdComment('HOLD', 'KF-X-001', {}, fields);
    const comments = [hold, grantComment()];
    const entry = collectAuthority(comments).candidates.find((c) => c.comment_id === hold.id);
    assert.ok(entry, `${name}: a candidate`);
    assert.notDeepEqual(entry.problems, [], `${name}: malformed`);
    const v = verdict(comments);
    assert.equal(v.reason, GRANT_REASONS.HOLD_ACTIVE, name);
    assert.equal(v.detail.comment_id, hold.id, name);
    assert.equal(v.detail.malformed, true, name);
    // Referent: a later valid HOLD_CLEAR for the target packet releases it.
    const released = [holdComment('HOLD', 'KF-X-001', {}, fields), holdComment('RESUME', 'KF-X-001'), grantComment()];
    assert.equal(verdict(released).granted, true, `${name}: released`);
  }
  // A malformed re-HOLD after a release holds again (built in #80 order).
  const first = holdComment('HOLD', 'KF-X-001');
  const release = holdComment('RESUME', 'KF-X-001');
  const again = holdComment('HOLD', 'KF-X-001', {}, { scope_changed: undefined });
  const cycle = [first, release, again, grantComment()];
  const v = verdict(cycle);
  assert.equal(v.reason, GRANT_REASONS.HOLD_ACTIVE);
  assert.equal(v.detail.comment_id, again.id);
});

test('NC malformed hold type: a repeated, lower-case, undeclared or absent type from chatgpt is a hold claim', () => {
  const types = [
    ['a HOLD repeated behind a REVIEW', ['REVIEW', 'HOLD']],
    ['a HOLD repeated behind a RESUME', ['RESUME', 'HOLD']],
    ['lower case', 'hold'],
    ['undeclared', 'PAUSE'],
    ['absent', undefined],
  ];
  for (const [name, type] of types) {
    const hold = holdComment('HOLD', 'KF-X-001', {}, { message_type: type });
    const comments = [hold, grantComment()];
    const entry = collectAuthority(comments).candidates.find((c) => c.comment_id === hold.id);
    assert.ok(entry, `${name}: a candidate`);
    assert.notDeepEqual(entry.problems, [], `${name}: malformed`);
    const v = verdict(comments);
    assert.equal(v.reason, GRANT_REASONS.HOLD_ACTIVE, name);
    assert.equal(v.detail.comment_id, hold.id, name);
  }
});

// Each case starts the target's lifetime with its DIRECTIVE, so the claim is
// at or after the floor (CG-REV-F9-004, A1).
test('NC malformed hold packet: a malformed hold claim whose packet cannot be read holds the target', () => {
  for (const [name, packet] of [['absent', undefined], ['blank', null], ['repeated, other packets', ['KF-OTHER-001', 'KF-OTHER-002']]]) {
    const directive = directiveComment();
    const hold = holdComment('HOLD', 'KF-X-001', {}, { packet_id: packet, scope_changed: undefined });
    const v = verdict([directive, hold, grantComment()]);
    assert.equal(v.reason, GRANT_REASONS.HOLD_ACTIVE, name);
    assert.equal(v.detail.comment_id, hold.id, name);
    assert.equal(v.detail.packet_id, 'KF-X-001', `${name}: released only by the target packet`);
    // Only a later valid HOLD_CLEAR for the target packet releases it.
    const other = [directiveComment(), holdComment('HOLD', 'KF-X-001', {}, { packet_id: packet, scope_changed: undefined }), holdComment('RESUME', 'KF-OTHER-001'), grantComment()];
    assert.equal(reasonOf(other), GRANT_REASONS.HOLD_ACTIVE, `${name}: another packet's release`);
    const own = [directiveComment(), holdComment('HOLD', 'KF-X-001', {}, { packet_id: packet, scope_changed: undefined }), holdComment('RESUME', 'KF-X-001'), grantComment()];
    assert.equal(verdict(own).granted, true, `${name}: the target's release`);
  }
});

test('malformed hold scope: the rules CG-REV-F9-003 kept still hold', () => {
  // A malformed HOLD on another readable packet that names neither the target PR nor branch does not apply.
  const elsewhere = holdComment('HOLD', 'KF-OTHER-001', {}, { scope_changed: undefined });
  assert.equal(verdict([elsewhere, grantComment()]).granted, true);
  // A malformed REVIEW about the target before the grant is still superseded by it.
  const review = comment(body({ ...grantFields({ message_id: 'M1', merge_authority: 'false' }), health: ['GREEN', 'RED'] }));
  assert.equal(verdict([review, grantComment()]).granted, true);
  // A malformed RESUME releases nothing, and before the grant it holds nothing either.
  const resume = holdComment('RESUME', 'KF-X-001', {}, { scope_changed: undefined });
  assert.equal(verdict([resume, grantComment()]).granted, true);
  const hold = holdComment('HOLD', 'KF-X-001');
  const bad = holdComment('RESUME', 'KF-X-001', {}, { scope_changed: undefined });
  assert.equal(reasonOf([hold, bad, grantComment()]), GRANT_REASONS.HOLD_ACTIVE);
  // A malformed HOLD on the target after the grant is still ambiguous, as before.
  assert.equal(reasonOf([grantComment(), holdComment('HOLD', 'KF-X-001', {}, { scope_changed: undefined })]), GRANT_REASONS.AMBIGUOUS);
});

// COV-HOLD-01 (CC-PROGRESS-F9-PROBE-001): a HOLD holds by its type. An
// envelope-valid HOLD whose effect readEffect() rejects is still a hold.
test('NC hold effect: an envelope-valid HOLD whose effect readEffect rejects still holds the target', () => {
  const variants = [
    ['missing effect', (b) => b.replace('control_effect: HOLD_SET\n', ''), 'CONTROL_EFFECT_MISSING'],
    ['invalid health', (b) => b.replace('health: YELLOW', 'health: AMBER'), 'CONTROL_EFFECT_HEALTH_INVALID'],
    ['production touched', (b) => b.replace('production_touched: false', 'production_touched: true'), 'CONTROL_EFFECT_PRODUCTION_TOUCHED'],
    ['production untouched not stated', (b) => b.replace('production_touched: false', 'production_touched: null'), 'CONTROL_EFFECT_PRODUCTION_TOUCHED'],
    ['programme field', (b) => b.replace('control_effect: HOLD_SET\n', 'control_effect: HOLD_SET\nprogramme_action: ACTIVATE\n'), 'CONTROL_EFFECT_PROGRAMME_NOT_FOLDABLE'],
    ['release effect on a HOLD', (b) => b.replace('control_effect: HOLD_SET', 'control_effect: HOLD_CLEAR'), 'CONTROL_EFFECT_TYPE_MISMATCH'],
    ['effect in lower case', (b) => b.replace('control_effect: HOLD_SET', 'control_effect: hold_set'), 'CONTROL_EFFECT_UNKNOWN'],
  ];
  for (const [name, change, code] of variants) {
    const hold = holdComment('HOLD', 'KF-X-001');
    hold.body = change(hold.body);
    const comments = [hold, grantComment()];
    const entry = collectAuthority(comments).candidates.find((c) => c.comment_id === hold.id);
    assert.deepEqual(entry.problems, [], `${name}: envelope-valid`);
    assert.equal(readEffect(entry).code, code, name);
    const v = verdict(comments);
    assert.equal(v.reason, GRANT_REASONS.HOLD_ACTIVE, name);
    assert.equal(v.detail.comment_id, hold.id, name);
    assert.equal(v.detail.malformed, false, name);
    // Referent: its own packet's later valid HOLD_CLEAR releases it.
    const again = holdComment('HOLD', 'KF-X-001');
    again.body = change(again.body);
    assert.equal(verdict([again, holdComment('RESUME', 'KF-X-001'), grantComment()]).granted, true, `${name}: released`);
  }
});

// CG-REV-F9-004 (A1): the target's lifetime starts at its floor, the first
// valid authority message about it in #80 order. A hold claim older than the
// floor, whose packet cannot be read and which names nothing of the target,
// holds nothing for it. Every case is built in the #80 order it asserts.
test('NC real history (A1): PLAN 5826799265, older than the target, is not a hold on it; after the floor it is', () => {
  const plan = realPlanComment();
  assert.equal(plan.body, PLAN_5826799265_BODY);
  assert.equal(plan.body.length, 1327, 'the public body, byte for byte');
  assert.equal(plan.body.includes('\r'), false);
  const elsewhere = directiveComment({ message_id: 'CG-DIRECTIVE-SYNTHETIC-OTHER', packet_id: 'KF-OTHER-001', pr_number: 41, implementation_branch: 'impl/other' });
  const directive = directiveComment();
  const comments = [plan, elsewhere, directive, grantComment()];
  const authority = collectAuthority(comments);
  assert.equal(authority.verified, true);
  const entry = authority.candidates.find((c) => c.comment_id === 5826799265);
  assert.ok(entry, 'the PLAN is an authority candidate');
  assert.notDeepEqual(entry.problems, [], 'malformed');
  assert.deepEqual(entry.envelope.values.message_type, ['PLAN'], 'a hold claim by its type');
  assert.equal(Object.hasOwn(entry.envelope.values, 'packet_id'), false, 'no packet');
  assert.equal(authority.candidates.indexOf(entry), 0, 'first in #80 order');
  const v = verdict(comments);
  assert.equal(v.granted, true, JSON.stringify(v.detail));
  assert.equal(v.reason, GRANT_REASONS.GRANTED);
  // The target's own later HOLD and release are not a duplicate of the PLAN.
  const cycle = [realPlanComment(), directiveComment(), holdComment('HOLD', 'KF-X-001'), holdComment('RESUME', 'KF-X-001'), grantComment()];
  assert.equal(verdict(cycle).granted, true, 'HOLD, HOLD_CLEAR in the target lifetime');
  const held = [realPlanComment(), directiveComment(), holdComment('HOLD', 'KF-X-001'), grantComment()];
  assert.equal(reasonOf(held), GRANT_REASONS.HOLD_ACTIVE, 'a true target hold still holds');
  // Distinguishing negative: the identical envelope after the floor holds the target.
  const floor = directiveComment();
  const late = realPlanComment({ id: undefined, created_at: undefined });
  const after = [floor, late, grantComment()];
  const h = verdict(after);
  assert.equal(h.reason, GRANT_REASONS.HOLD_ACTIVE);
  assert.equal(h.detail.comment_id, late.id);
  assert.equal(h.detail.packet_id, 'KF-X-001');
  assert.equal(h.detail.malformed, true);
});

// Hold claims whose packet cannot be read and which name nothing of the target.
const packetlessClaims = [
  ['the PLAN 5826799265 envelope', () => realPlanComment({ id: undefined, created_at: undefined })],
  ['a HOLD with no packet', () => holdComment('HOLD', 'KF-X-001', {}, { packet_id: undefined, scope_changed: undefined })],
  ['a HOLD with a blank packet', () => holdComment('HOLD', 'KF-X-001', {}, { packet_id: null })],
  ['a HOLD with repeated other packets', () => holdComment('HOLD', 'KF-X-001', {}, { packet_id: ['KF-OTHER-001', 'KF-OTHER-002'] })],
  ['an untyped claim with no packet', () => holdComment('HOLD', 'KF-X-001', {}, { message_type: undefined, packet_id: undefined })],
];

test('NC lifetime floor (A1) (a): a packet-less claim older than the target\'s first valid authority does not hold it', () => {
  for (const [name, make] of packetlessClaims) {
    const claim = make();
    const comments = [claim, directiveComment(), grantComment()];
    const entry = collectAuthority(comments).candidates.find((c) => c.comment_id === claim.id);
    assert.ok(entry, `${name}: a candidate`);
    assert.notDeepEqual(entry.problems, [], `${name}: malformed`);
    assert.equal(verdict(comments).granted, true, name);
    // With the grant as the target's only message, the claim is older than the floor too.
    assert.equal(verdict([make(), grantComment()]).granted, true, `${name}: before a lone grant`);
  }
});

test('NC lifetime floor (A1) (b): the identical claim at or after the target\'s first valid authority holds it before a later grant', () => {
  for (const [name, make] of packetlessClaims) {
    const directive = directiveComment();
    const claim = make();
    const v = verdict([directive, claim, grantComment()]);
    assert.equal(v.reason, GRANT_REASONS.HOLD_ACTIVE, name);
    assert.equal(v.detail.comment_id, claim.id, name);
    assert.equal(v.detail.packet_id, 'KF-X-001', `${name}: released only by the target packet`);
    // The floor is the first valid message about the target, whatever its type.
    const review = followUp();
    const claim2 = make();
    assert.equal(reasonOf([review, claim2, grantComment()]), GRANT_REASONS.HOLD_ACTIVE, `${name}: after a REVIEW`);
    // A claim between two target messages is inside the lifetime.
    assert.equal(reasonOf([directiveComment(), followUp(), make(), grantComment()]), GRANT_REASONS.HOLD_ACTIVE, `${name}: mid-lifetime`);
    // After the grant it is ambiguous, as before.
    assert.equal(reasonOf([directiveComment(), grantComment(), make()]), GRANT_REASONS.AMBIGUOUS, `${name}: after the grant`);
  }
});

test('NC lifetime floor (A1) (c): a claim older than the floor that names the target by packet, PR or branch still holds it', () => {
  const named = [
    ['a malformed HOLD on the target packet', { scope_changed: undefined }, 'KF-X-001'],
    ['a packet-less HOLD naming the target PR', { packet_id: undefined, pr_number: 87 }, 'KF-X-001'],
    ['a packet-less HOLD naming the target branch', { packet_id: undefined, implementation_branch: 'impl/x' }, 'KF-X-001'],
    ['a HOLD whose repeated packet includes the target', { packet_id: ['KF-OTHER-001', 'KF-X-001'] }, 'KF-X-001'],
    ['a malformed HOLD under another packet naming the target PR', { packet_id: 'KF-OTHER-001', pr_number: 87, scope_changed: undefined }, 'KF-OTHER-001'],
    ['a malformed HOLD under another packet naming the target branch', { packet_id: 'KF-OTHER-001', implementation_branch: 'impl/x', scope_changed: undefined }, 'KF-OTHER-001'],
  ];
  for (const [name, fields, key] of named) {
    const claim = holdComment('HOLD', 'KF-X-001', {}, fields);
    const comments = [claim, directiveComment(), grantComment()];
    assert.notDeepEqual(collectAuthority(comments).candidates.find((c) => c.comment_id === claim.id).problems, [], `${name}: malformed`);
    const v = verdict(comments);
    assert.equal(v.reason, GRANT_REASONS.HOLD_ACTIVE, name);
    assert.equal(v.detail.comment_id, claim.id, name);
    assert.equal(v.detail.packet_id, key, name);
  }
  // A valid HOLD naming the target is itself about the target, so it is the floor.
  const valid = holdComment('HOLD', 'KF-OTHER-001', {}, { pr_number: 87 });
  assert.equal(reasonOf([valid, directiveComment(), grantComment()]), GRANT_REASONS.HOLD_ACTIVE, 'a valid HOLD naming the target PR');
});

test('NC lifetime floor (A1) (d): an unrelated readable-packet HOLD does not block, and keeps its duplicate rule', () => {
  for (const fields of [{}, { scope_changed: undefined }]) {
    const before = [holdComment('HOLD', 'KF-OTHER-001', {}, fields), directiveComment(), grantComment()];
    assert.equal(verdict(before).granted, true, `before the floor: ${JSON.stringify(fields)}`);
    const after = [directiveComment(), holdComment('HOLD', 'KF-OTHER-001', {}, fields), grantComment()];
    assert.equal(verdict(after).granted, true, `after the floor: ${JSON.stringify(fields)}`);
  }
  // The bound is for packet-less claims only: a readable claim older than the
  // floor still counts as a second hold on a packet that holds the target.
  const first = holdComment('HOLD', 'KF-OTHER-001', {}, { pr_number: 87, scope_changed: undefined });
  const second = holdComment('HOLD', 'KF-OTHER-001', {}, { scope_changed: undefined });
  const v = verdict([first, second, directiveComment(), holdComment('RESUME', 'KF-OTHER-001'), grantComment()]);
  assert.equal(v.reason, GRANT_REASONS.HOLD_DUPLICATE);
  assert.equal(v.detail.hold.comment_id, first.id);
  assert.equal(v.detail.duplicate.comment_id, second.id);
});

test('NC lifetime floor (A1) (e): only a later effect-valid HOLD_CLEAR for the hold\'s own packet releases a lifetime claim', () => {
  for (const [name, make] of packetlessClaims) {
    // The RESUME is built after the floor and the claim, so it is newer than both.
    const release = (packet, fields = {}) => [directiveComment(), make(), holdComment('RESUME', packet, {}, fields), grantComment()];
    assert.equal(reasonOf(release('KF-OTHER-001')), GRANT_REASONS.HOLD_ACTIVE, `${name}: another packet's release`);
    assert.equal(reasonOf(release('KF-OTHER-001', { pr_number: 87, implementation_branch: 'impl/x' })), GRANT_REASONS.HOLD_ACTIVE, `${name}: a release by reference`);
    assert.equal(reasonOf(release('KF-X-001', { health: 'AMBER' })), GRANT_REASONS.HOLD_ACTIVE, `${name}: an effect-invalid release`);
    assert.equal(reasonOf(release('KF-X-001', { scope_changed: undefined })), GRANT_REASONS.HOLD_ACTIVE, `${name}: a malformed release`);
    assert.equal(verdict(release('KF-X-001')).granted, true, `${name}: the target's release`);
    // A release older than the claim releases nothing.
    const early = [directiveComment(), holdComment('RESUME', 'KF-X-001'), make(), grantComment()];
    assert.equal(reasonOf(early), GRANT_REASONS.HOLD_ACTIVE, `${name}: an older release`);
    // A second claim in the lifetime with no release between is a duplicate.
    const twice = [directiveComment(), make(), make(), holdComment('RESUME', 'KF-X-001'), grantComment()];
    assert.equal(reasonOf(twice), GRANT_REASONS.HOLD_DUPLICATE, `${name}: twice`);
  }
});

// CG-REV-F9-003 Q2: a second hold on a held packet is HOLD_DUPLICATE in the
// canonical fold. The predicate denies by name and reads no later RESUME as
// curing it.
test('NC hold duplicate: HOLD, HOLD and a later RESUME denies by name; HOLD, HOLD_CLEAR, HOLD, HOLD_CLEAR grants', () => {
  const first = holdComment('HOLD', 'KF-X-001');
  const second = holdComment('HOLD', 'KF-X-001');
  const v = verdict([first, second, holdComment('RESUME', 'KF-X-001'), grantComment()]);
  assert.equal(v.reason, GRANT_REASONS.HOLD_DUPLICATE);
  assert.equal(v.detail.packet_id, 'KF-X-001');
  assert.equal(v.detail.hold.comment_id, first.id);
  assert.equal(v.detail.duplicate.comment_id, second.id);
  // Two RESUMEs do not cure it either.
  const twice = [holdComment('HOLD', 'KF-X-001'), holdComment('HOLD', 'KF-X-001'), holdComment('RESUME', 'KF-X-001'), holdComment('RESUME', 'KF-X-001'), grantComment()];
  assert.equal(reasonOf(twice), GRANT_REASONS.HOLD_DUPLICATE);
  // A malformed hold claim on the held packet is a second hold too.
  const malformed = [holdComment('HOLD', 'KF-X-001'), holdComment('HOLD', 'KF-X-001', {}, { scope_changed: undefined }), holdComment('RESUME', 'KF-X-001'), grantComment()];
  assert.equal(reasonOf(malformed), GRANT_REASONS.HOLD_DUPLICATE);
  // A HOLD on a packet that already holds the target by reference is a duplicate on that packet.
  const byReference = [holdComment('HOLD', 'KF-OTHER-001', {}, { pr_number: 87 }), holdComment('HOLD', 'KF-OTHER-001'), holdComment('RESUME', 'KF-OTHER-001'), grantComment()];
  assert.equal(verdict(byReference).detail.packet_id, 'KF-OTHER-001');
  assert.equal(reasonOf(byReference), GRANT_REASONS.HOLD_DUPLICATE);
  // Referent: a release between the two holds makes it a re-HOLD, which its own release clears.
  const cycle = [holdComment('HOLD', 'KF-X-001'), holdComment('RESUME', 'KF-X-001'), holdComment('HOLD', 'KF-X-001'), holdComment('RESUME', 'KF-X-001'), grantComment()];
  assert.equal(verdict(cycle).granted, true);
  // Duplicate holds on an unrelated packet are not this target's to judge.
  const unrelated = [holdComment('HOLD', 'KF-OTHER-001'), holdComment('HOLD', 'KF-OTHER-001'), grantComment()];
  assert.equal(verdict(unrelated).granted, true);
});

// CG-REV-F9-003 Q3: a valid HOLD that names the target by packet, PR or branch
// holds it, whatever its own packet. Only a later valid HOLD_CLEAR for the
// HOLD's own packet releases it.
function assertHoldByReference(fields) {
  const hold = holdComment('HOLD', 'KF-OTHER-001', {}, fields);
  const comments = [hold, grantComment()];
  assert.deepEqual(collectAuthority(comments).candidates.find((c) => c.comment_id === hold.id).problems, []);
  const v = verdict(comments);
  assert.equal(v.reason, GRANT_REASONS.HOLD_ACTIVE);
  assert.equal(v.detail.comment_id, hold.id);
  assert.equal(v.detail.packet_id, 'KF-OTHER-001');
  // Referent: its own packet's later HOLD_CLEAR releases it.
  assert.equal(verdict([holdComment('HOLD', 'KF-OTHER-001', {}, fields), holdComment('RESUME', 'KF-OTHER-001'), grantComment()]).granted, true);
}

test('NC hold by PR: a valid HOLD under another packet that names the target PR number holds the target', () => {
  assertHoldByReference({ pr_number: 87 });
});

test('NC hold by branch: a valid HOLD under another packet that names the target branch holds the target', () => {
  assertHoldByReference({ implementation_branch: 'impl/x' });
});

test('NC hold cross-packet release: only the HOLD\'s own packet releases it, never the target\'s or a reference', () => {
  for (const fields of [{ pr_number: 87 }, { implementation_branch: 'impl/x' }]) {
    const hold = holdComment('HOLD', 'KF-OTHER-001', {}, fields);
    const targets = holdComment('RESUME', 'KF-X-001');
    const v = verdict([hold, targets, grantComment()]);
    assert.equal(v.reason, GRANT_REASONS.HOLD_ACTIVE, `the target packet's release: ${JSON.stringify(fields)}`);
    assert.equal(v.detail.comment_id, hold.id);
    const hold2 = holdComment('HOLD', 'KF-OTHER-001', {}, fields);
    const reference = holdComment('RESUME', 'KF-THIRD-001', {}, { pr_number: 87, implementation_branch: 'impl/x' });
    const v2 = verdict([hold2, reference, grantComment()]);
    assert.equal(v2.reason, GRANT_REASONS.HOLD_ACTIVE, `a release naming the target PR and branch: ${JSON.stringify(fields)}`);
    assert.equal(v2.detail.comment_id, hold2.id);
  }
  // Both holds active: each needs its own release.
  const both = [holdComment('HOLD', 'KF-X-001'), holdComment('HOLD', 'KF-OTHER-001', {}, { pr_number: 87 }), holdComment('RESUME', 'KF-X-001'), grantComment()];
  assert.equal(reasonOf(both), GRANT_REASONS.HOLD_ACTIVE);
  const cleared = [holdComment('HOLD', 'KF-X-001'), holdComment('HOLD', 'KF-OTHER-001', {}, { pr_number: 87 }), holdComment('RESUME', 'KF-X-001'), holdComment('RESUME', 'KF-OTHER-001'), grantComment()];
  assert.equal(verdict(cleared).granted, true);
  // A genuinely unrelated HOLD stays unrelated.
  const unrelated = holdComment('HOLD', 'KF-OTHER-001', {}, { pr_number: 999, implementation_branch: 'impl/else' });
  assert.equal(verdict([unrelated, grantComment()]).granted, true);
});

test('NC hold release order: a HOLD_CLEAR older than the HOLD, or before a re-HOLD, releases nothing', () => {
  const early = holdComment('RESUME', 'KF-X-001');
  const hold = holdComment('HOLD', 'KF-X-001');
  assert.ok(Date.parse(early.created_at) < Date.parse(hold.created_at), 'the RESUME precedes the HOLD');
  const stale = verdict([early, hold, grantComment()]);
  assert.equal(stale.reason, GRANT_REASONS.HOLD_ACTIVE);
  assert.equal(stale.detail.comment_id, hold.id);
  const first = holdComment('HOLD', 'KF-X-001');
  const release = holdComment('RESUME', 'KF-X-001');
  const again = holdComment('HOLD', 'KF-X-001');
  const rehold = verdict([first, release, again, grantComment()]);
  assert.equal(rehold.reason, GRANT_REASONS.HOLD_ACTIVE);
  assert.equal(rehold.detail.comment_id, again.id, 'the second HOLD is the active one');
  // Referent: a release after the re-HOLD grants.
  const cycle = [holdComment('HOLD', 'KF-X-001'), holdComment('RESUME', 'KF-X-001'), holdComment('HOLD', 'KF-X-001'), holdComment('RESUME', 'KF-X-001'), grantComment()];
  assert.equal(verdict(cycle).granted, true);
});

test('NC hold release authority: a RESUME that is not valid authority releases nothing', () => {
  const variants = [
    ['outside the allowlist', (c) => { c.user = { login: 'someone-else' }; }],
    ['not from chatgpt', (c) => { c.body = c.body.replace('sender: chatgpt', 'sender: claude'); }],
    ['malformed (effect repeated)', (c) => { c.body = c.body.replace('control_effect: HOLD_CLEAR\n', 'control_effect: HOLD_CLEAR\ncontrol_effect: HOLD_CLEAR\n'); }],
    // COV-HOLD-04: malformed elsewhere, so the effect and packet still read as one HOLD_CLEAR for the target.
    ['malformed (scope_changed omitted)', (c) => { c.body = c.body.replace('scope_changed: false\n', ''); }, true],
    ['malformed (health repeated)', (c) => { c.body = c.body.replace('health: YELLOW\n', 'health: YELLOW\nhealth: RED\n'); }, true],
    ['malformed (unmatched quote)', (c) => { c.body = c.body.replace('state: BLOCKED', 'state: "BLOCKED'); }, true],
  ];
  for (const [name, change, readable] of variants) {
    const hold = holdComment('HOLD', 'KF-X-001');
    const resume = holdComment('RESUME', 'KF-X-001');
    change(resume);
    const comments = [hold, resume, grantComment()];
    const authority = collectAuthority(comments);
    assert.equal(authority.verified, true, name);
    assert.equal(authority.messages.some((m) => m.comment_id === resume.id), false, `${name}: not valid authority`);
    if (readable) {
      const entry = authority.candidates.find((c) => c.comment_id === resume.id);
      assert.notDeepEqual(entry.problems, [], `${name}: malformed`);
      assert.deepEqual(entry.envelope.values.message_type, ['RESUME'], `${name}: one readable type`);
      assert.deepEqual(entry.envelope.values.control_effect, ['HOLD_CLEAR'], `${name}: one readable HOLD_CLEAR`);
      assert.deepEqual(entry.envelope.values.packet_id, ['KF-X-001'], `${name}: the target packet`);
    }
    const v = verdict(comments);
    assert.equal(v.reason, GRANT_REASONS.HOLD_ACTIVE, name);
    assert.equal(v.detail.comment_id, hold.id, name);
  }
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

// CG-REV-F9-005: per-packet hold chronology. Every hold claim in scope is
// recorded on its packet whether or not it holds the target yet, so a first
// hold is never forgotten before a later hold on that packet names the
// target. A duplicate denies by name when the packet holds the target at any
// point; a packet that never concerns the target is not this target's to judge.
test('NC hold chronology (F9-005): a HOLD on another packet naming nothing of the target, then a HOLD on that packet naming the target, is a duplicate whatever follows', () => {
  for (const fields of [{ pr_number: 87 }, { implementation_branch: 'impl/x' }]) {
    const label = JSON.stringify(fields);
    // Built in #80 order: the unrelated hold first, the target-naming hold second.
    const first = holdComment('HOLD', 'KF-OTHER-001');
    const second = holdComment('HOLD', 'KF-OTHER-001', {}, fields);
    const v = verdict([first, second, holdComment('RESUME', 'KF-OTHER-001'), grantComment()]);
    assert.equal(v.reason, GRANT_REASONS.HOLD_DUPLICATE, `first unrelated, second names the target: ${label}`);
    assert.equal(v.detail.packet_id, 'KF-OTHER-001');
    assert.equal(v.detail.hold.comment_id, first.id);
    assert.equal(v.detail.duplicate.comment_id, second.id);
    assert.equal(v.detail.duplicate.malformed, false);
    // The opposite order denies the same way, naming the same two comments.
    const a = holdComment('HOLD', 'KF-OTHER-001', {}, fields);
    const b = holdComment('HOLD', 'KF-OTHER-001');
    const m = verdict([a, b, holdComment('RESUME', 'KF-OTHER-001'), grantComment()]);
    assert.equal(m.reason, GRANT_REASONS.HOLD_DUPLICATE, `first names the target, second unrelated: ${label}`);
    assert.equal(m.detail.hold.comment_id, a.id);
    assert.equal(m.detail.duplicate.comment_id, b.id);
    // After the floor, and with two releases, the same.
    const c = holdComment('HOLD', 'KF-OTHER-001');
    const d = holdComment('HOLD', 'KF-OTHER-001', {}, fields);
    assert.equal(reasonOf([directiveComment(), c, d, holdComment('RESUME', 'KF-OTHER-001'), holdComment('RESUME', 'KF-OTHER-001'), grantComment()]), GRANT_REASONS.HOLD_DUPLICATE, `after the floor: ${label}`);
    // A malformed first hold on the readable packet is still its first hold.
    const e = holdComment('HOLD', 'KF-OTHER-001', {}, { scope_changed: undefined });
    const f = holdComment('HOLD', 'KF-OTHER-001', {}, fields);
    const w = verdict([e, f, holdComment('RESUME', 'KF-OTHER-001'), grantComment()]);
    assert.equal(w.reason, GRANT_REASONS.HOLD_DUPLICATE, `malformed first hold: ${label}`);
    assert.equal(w.detail.hold.comment_id, e.id);
    // Without any release the duplicate still denies by name, not merely as a hold.
    const g = holdComment('HOLD', 'KF-OTHER-001');
    const h = holdComment('HOLD', 'KF-OTHER-001', {}, fields);
    assert.equal(reasonOf([g, h, grantComment()]), GRANT_REASONS.HOLD_DUPLICATE, `no release: ${label}`);
  }
  // Referent: a release between the two holds makes the second a re-HOLD, which its own release clears.
  const cycle = [holdComment('HOLD', 'KF-OTHER-001'), holdComment('RESUME', 'KF-OTHER-001'), holdComment('HOLD', 'KF-OTHER-001', {}, { pr_number: 87 }), holdComment('RESUME', 'KF-OTHER-001'), grantComment()];
  assert.equal(verdict(cycle).granted, true, 'release between the two holds');
  // Referent: two holds on a packet that never concerns the target still grant.
  const unrelated = [holdComment('HOLD', 'KF-OTHER-001'), holdComment('HOLD', 'KF-OTHER-001'), grantComment()];
  assert.equal(verdict(unrelated).granted, true, 'a packet that never concerns the target');
  // Referent: a released target hold, then an unrelated hold on the same packet, holds nothing (per-hold, Q3).
  const later = [holdComment('HOLD', 'KF-OTHER-001', {}, { pr_number: 87 }), holdComment('RESUME', 'KF-OTHER-001'), holdComment('HOLD', 'KF-OTHER-001'), grantComment()];
  assert.equal(verdict(later).granted, true, 'an unrelated hold after the target hold was released');
  // An unreleased unrelated hold on the packet is still not reported as holding the target.
  const unreleased = [holdComment('HOLD', 'KF-OTHER-001'), grantComment()];
  assert.equal(verdict(unreleased).granted, true, 'one unrelated hold');
});
