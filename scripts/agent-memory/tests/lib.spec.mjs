import test from 'node:test';
import assert from 'node:assert/strict';
import {
  subjectNamesPacket, subjectType, commitEvidence, wave2bMerged, deriveStatus, transitiveDependents,
  longestRemainingChain, readyList, buildStatus, renderStatusMd, parseRulings, resolveDecision,
  buildBundle, renderBundleMd, expandRulingIds, statusFingerprint,
} from '../lib.mjs';

const pk = (id, depends_on = [], extra = {}) => ({
  id, title: `title ${id}`, kind: 'new', step: 3, lane: 'server', size: 'S', priority: 'P2',
  depends_on, files: [], decisions: [], scope: 'scope', definition_of_done: 'dod', journeys: [], bugs: [], ...extra,
});
const c = (subject, sha = 'a'.repeat(40)) => ({ sha, subject });

test('subjectNamesPacket matches whole ids only', () => {
  assert.ok(subjectNamesPacket('fix(x): pkt/V1-NAV-B-HIDE (compacted)', 'NAV-B-HIDE'));
  assert.ok(!subjectNamesPacket('fix(x): pkt/V1-NAV-B-HIDE-2 (compacted)', 'NAV-B-HIDE'));
  assert.ok(!subjectNamesPacket('fix: FU-PROPOSAL-REVENUE-SIGHT-CODEX-REVIEWS', 'FU-PROPOSAL-REVENUE-SIGHT'));
  assert.ok(subjectNamesPacket('fix(wa): takes Escape (FU-WA-ESCAPE-RACE)', 'FU-WA-ESCAPE-RACE'));
});

test('subjectType reads the conventional prefix', () => {
  assert.equal(subjectType('fix(genome): x'), 'fix');
  assert.equal(subjectType('test: x'), 'test');
  assert.equal(subjectType('Merge v1 wave 3b part 1/2 (#217)'), 'merge');
  assert.equal(subjectType('v1 wave 2b: 28 packets (#214)'), 'other');
});

test('commitEvidence separates compacted, code and other commits', () => {
  const ev = commitEvidence('A-1', [
    c('fix(a): pkt/V1-A-1 (compacted)'), c('test(a): RED for pkt/V1-A-1 (compacted)'),
    c('docs(v1): add A-1'), c('fix(a): A-1 - repair'), c('fix(a): pkt/V1-A-10 (compacted)'),
  ]);
  assert.equal(ev.compacted.length, 1);
  assert.equal(ev.code.length, 2);
  assert.equal(ev.other.length, 2);
});

test('deriveStatus: each derivation and its certainty', () => {
  const base = { commits: [], wave2bOnMain: false, branches: [] };
  assert.deepEqual(
    deriveStatus(pk('A'), { ...base, commits: [c('fix: pkt/V1-A (compacted)', 'b'.repeat(40))] }),
    { status: 'done', derived_from: 'compacted-commit', uncertain: false, evidence: ['bbbbbbbb'] });
  assert.equal(deriveStatus(pk('A'), { ...base, priorRow: { status: 'merged-main' } }).derived_from, 'prior-status-file');
  // wave-2b rows are done only when the wave 2b commit is on main
  assert.equal(deriveStatus(pk('A'), { ...base, priorRow: { status: 'wave-2b' } }).status, 'in-progress');
  assert.equal(deriveStatus(pk('A'), { ...base, priorRow: { status: 'wave-2b' }, wave2bOnMain: true }).status, 'done');
  const loose = deriveStatus(pk('A'), { ...base, priorRow: { status: 'in-progress' }, commits: [c('fix(x): A - repair')] });
  assert.equal(loose.status, 'done');
  assert.equal(loose.uncertain, true);
  // a test-only or docs-only mention is not done
  assert.equal(deriveStatus(pk('A'), { ...base, commits: [c('test: RED for A'), c('docs: add A')] }).status, 'todo');
  const br = deriveStatus(pk('A'), { ...base, branches: ['pkt/V1-A'] });
  assert.equal(br.status, 'in-progress');
  assert.equal(br.uncertain, true);
  assert.equal(deriveStatus(pk('A'), base).derived_from, 'no-evidence');
});

test('deriveStatus: a tests-only packet is done on its compacted RED commit alone', () => {
  // compact.sh gives a tests-only packet (gate and census packets) one commit, its RED commit (Codex review of #221).
  const base = { commits: [], wave2bOnMain: false, branches: [] };
  assert.deepEqual(
    deriveStatus(pk('A'), { ...base, commits: [c('test(web): RED for pkt/V1-A (compacted)', 'c'.repeat(40))] }),
    { status: 'done', derived_from: 'compacted-tests-only', uncertain: false, evidence: ['cccccccc'] });
  // a code packet keeps its fix commit as the evidence
  const both = deriveStatus(pk('A'), { ...base, commits: [
    c('test(web): RED for pkt/V1-A (compacted)', 'c'.repeat(40)), c('fix(web): pkt/V1-A (compacted)', 'd'.repeat(40))] });
  assert.equal(both.derived_from, 'compacted-commit');
  assert.deepEqual(both.evidence, ['dddddddd']);
  // whole ids only, and a loose RED mention still is not done
  assert.equal(deriveStatus(pk('A'), { ...base, commits: [c('test(web): RED for pkt/V1-A-2 (compacted)')] }).status, 'todo');
  assert.equal(deriveStatus(pk('A'), { ...base, commits: [c('test: RED for A')] }).status, 'todo');
  // the whole subject must be the RED subject (M36 wave security confirmation, MINOR-1)
  assert.equal(deriveStatus(pk('A'), { ...base, commits: [c('test(web): RED for pkt/V1-A (compacted) revert')] }).status, 'todo');
  assert.equal(deriveStatus(pk('B'), { ...base, commits: [c('test(web): RED for pkt/V1-A (compacted), B RED for pkt/V1-B (compacted)')] }).status, 'todo');
  assert.equal(deriveStatus(pk('A'), { ...base, commits: [c('test(web)!: RED for pkt/V1-A (compacted)')] }).status, 'todo');
  assert.equal(deriveStatus(pk('A'), { ...base, commits: [c('test: RED for pkt/V1-A (compacted)')] }).status, 'done');
  assert.equal(deriveStatus(pk('A.B'), { ...base, commits: [c('test(web): RED for pkt/V1-AxB (compacted)')] }).status, 'todo');
});

test('wave2bMerged', () => {
  assert.ok(wave2bMerged([c('v1 wave 2b: 28 packets and the v1 handoff guide (#214)')]));
  assert.ok(!wave2bMerged([c('docs: about v1 wave 2b')]));
});

test('transitiveDependents and readyList ranking', () => {
  // A <- B <- C ; A <- D ; E alone ; F on the critical path ; G waits on a todo packet
  const packets = [pk('A'), pk('B', ['A']), pk('C', ['B']), pk('D', ['A']), pk('E', [], { priority: 'P0' }), pk('F'), pk('G', ['E'])];
  assert.deepEqual([...transitiveDependents(packets).get('A')].sort(), ['B', 'C', 'D']);
  const st = { A: 'todo', B: 'todo', C: 'todo', D: 'todo', E: 'todo', F: 'todo', G: 'todo' };
  assert.deepEqual(readyList(packets, st, ['F']).map((r) => r.id), ['F', 'A', 'E']);
  // done dependencies release their dependents; in-progress packets are not offered
  const st2 = { ...st, A: 'done', E: 'in-progress' };
  assert.deepEqual(readyList(packets, st2, []).map((r) => r.id), ['B', 'D', 'F']);
});

test('longestRemainingChain skips done packets and weighs by size', () => {
  const packets = [pk('A'), pk('B', ['A'], { size: 'L' }), pk('C', ['B']), pk('X'), pk('Y', ['X'])];
  const all = Object.fromEntries(packets.map((p) => [p.id, 'todo']));
  assert.deepEqual(longestRemainingChain(packets, all), { weight: 5, chain: ['A', 'B', 'C'] });
  assert.deepEqual(longestRemainingChain(packets, { ...all, A: 'done', B: 'done' }), { weight: 2, chain: ['X', 'Y'] });
});

test('buildStatus counts, deps_met and the Markdown view', () => {
  const plan = { packets: [pk('A', [], { size: 'M' }), pk('B', ['A']), pk('C', ['B']), pk('N')], validation: { critical_path: ['A', 'B', 'C'] } };
  const prior = { packets: [{ id: 'A', status: 'merged-main' }, { id: 'B', status: 'todo' }, { id: 'C', status: 'todo' }] };
  const s = buildStatus({ plan, prior, commits: [], branches: ['pkt/V1-N'], mainSha: 'f'.repeat(40), mainDate: '2026-11-22', baseSha: null });
  assert.equal(s.summary.by_status.done.packets, 1);
  assert.equal(s.summary.by_status.done.pct_by_points, 40);
  assert.equal(s.summary.by_status['in-progress'].packets, 1);
  assert.deepEqual(s.summary.uncertain, ['N']);
  assert.deepEqual(s.ready.map((r) => r.id), ['B']);
  assert.deepEqual(s.critical_path.plan_recorded_remaining, ['B', 'C']);
  assert.equal(s.packets.find((p) => p.id === 'C').deps_met, false);
  const md = renderStatusMd(s);
  assert.match(md, /\| done \| 1 \| 2 \| 40% \|/);
  assert.match(md, /B > C/);
  // deterministic for the same inputs
  assert.equal(JSON.stringify(s), JSON.stringify(buildStatus({ plan, prior, commits: [], branches: ['pkt/V1-N'], mainSha: 'f'.repeat(40), mainDate: '2026-11-22', baseSha: null })));
});

const MAP = [
  '## (g) Open decisions', '', '| Id | Question | Effect |', '|---|---|---|',
  '| D-11 | **Authority policy.** who? | R0-09 |',
  '### Owner rulings, 2026-10-31', '',
  '| D-11 | Owner only. | R0-09 implements it |',
  '| D-150 | Seven hubs: adopt. (`hubs`) | NAV-A1 and 12 more |',
  '| D-222 | Standing directive. | (process) |',
  '| D-41..D-43, D-47 | Kept as built. | none |',
].join('\n');

test('parseRulings and resolveDecision: ids, slugs, repeated ids, headings, lines', () => {
  const r = parseRulings(MAP);
  assert.equal(r.length, 8);
  assert.deepEqual(expandRulingIds('D-41..D-43, D-47'), ['D-41', 'D-42', 'D-43', 'D-47']);
  assert.equal(resolveDecision('D-42', r)[0].text, 'Kept as built.');
  assert.equal(resolveDecision('D-44', r).length, 0);
  // A ruling supersedes the open-question row for the same id (Codex on #221).
  assert.deepEqual(resolveDecision('D-11', r).map((x) => [x.heading, x.line]), [['Owner rulings, 2026-10-31', 8]]);
  const hubs = resolveDecision('hubs', r);
  assert.equal(hubs[0].id, 'D-150');
  assert.equal(hubs[0].effect, 'NAV-A1 and 12 more');
  assert.deepEqual(resolveDecision('D-999', r), []);
});

test('buildBundle: rulings in full, write set, dependencies, register rows, health', () => {
  const plan = {
    packets: [pk('A'), pk('B', ['A'], { files: ['src/a.ts', 'test/new.test.ts'], decisions: ['hubs', 'D-11', 'D-999'], journeys: ['H'] })],
    r0_register: [{ packet: 'B', r0_case: 'case-1', change: 'KEEP: x' }, { packet: 'A', r0_case: 'other', change: 'KEEP' }],
    fixture_prefix_table: [{ prefix: 'v99a_', owner: 'test/new.test.ts', packet: 'V1-99 (B)' }],
  };
  const args = { plan, packetId: 'B', rulings: parseRulings(MAP), statusById: { A: 'todo', B: 'todo' }, fileExists: (p) => p === 'src/a.ts', mainSha: 'f'.repeat(40), statusSource: 'test' };
  const b = buildBundle(args);
  assert.equal(b.health.status, 'DEGRADED');
  assert.deepEqual(b.unresolved.missing_required_sources, ['D-999']);
  assert.deepEqual(b.write_set, [{ path: 'src/a.ts', exists: true }, { path: 'test/new.test.ts', exists: false }]);
  assert.deepEqual(b.dependencies, [{ id: 'A', status: 'todo' }]);
  assert.equal(b.dependencies_met, false);
  assert.equal(b.r0_register.length, 1);
  assert.equal(b.fixture_prefixes[0].prefix, 'v99a_');
  assert.equal(b.semantic_context.invariants.length, 2); // hubs + D-11's ruling (its open-question row is superseded)
  assert.equal(b.semantic_context.invariants[0].source, 'docs/reconstruction/BUILD-MAP-001.md:9');
  for (const k of ['schema_version', 'generator', 'snapshot', 'health', 'task', 'authority', 'semantic_context', 'proof_context', 'unresolved', 'provenance', 'excluded']) {
    assert.ok(k in b, `required schema field ${k}`);
  }
  const md = renderBundleMd(b);
  assert.match(md, /Seven hubs: adopt\./);
  assert.match(md, /### D-999\n\nNOT FOUND/);
  assert.match(md, /`test\/new\.test\.ts` \(new\)/);
  assert.match(md, /NOT READY/);
  const ok = buildBundle({ ...args, statusById: { A: 'done', B: 'todo' }, plan: { ...plan, packets: [pk('A'), pk('B', ['A'], { decisions: ['hubs'] })] } });
  assert.equal(ok.health.status, 'VALID');
  assert.equal(ok.dependencies_met, true);
  assert.equal(buildBundle({ ...args, packetId: 'NOPE' }), null);
  // the standing directive missing from the build map degrades every bundle
  const noDirective = buildBundle({ ...args, rulings: parseRulings(MAP).filter((x) => x.id !== 'D-222'), plan: { ...plan, packets: [pk('A'), pk('B', ['A'])] } });
  assert.equal(noDirective.health.status, 'DEGRADED');
  assert.equal(noDirective.authority.current.freshness, 'UNVERIFIABLE');
});

test('statusFingerprint ignores the main sha and date, nothing else', () => {
  const plan = { packets: [pk('A'), pk('B', ['A'])], validation: { critical_path: [] } };
  const mk = (sha, commits = []) => buildStatus({ plan, prior: null, commits, branches: null, mainSha: sha, mainDate: sha, baseSha: null });
  assert.equal(statusFingerprint(mk('a'.repeat(40))), statusFingerprint(mk('b'.repeat(40))));
  assert.notEqual(statusFingerprint(mk('a'.repeat(40))), statusFingerprint(mk('a'.repeat(40), [c('fix: pkt/V1-A (compacted)')])));
});

test('readyList breaks ties by priority, then id', () => {
  const packets = [pk('Z', [], { priority: 'P0' }), pk('B', [], { priority: 'P1' }), pk('A', [], { priority: 'P1' })];
  assert.deepEqual(readyList(packets, { Z: 'todo', A: 'todo', B: 'todo' }, []).map((r) => r.id), ['Z', 'A', 'B']);
});

// Codex review of #221 (P1): a D-id that is both an open question and, later, a ruling resolves to the ruling only.
test('resolveDecision prefers the ruling row over the superseded open-question row', () => {
  const md = [
    '## (g) Open decisions for the owner (and ChatGPT where marked)',
    '| D-11 | **Authority policy.** settings:write for business config? | open |',
    '| D-12 | Still open? | open |',
    '### Owner rulings, 2026-10-31',
    '| D-11 | Editing the business profile is OWNER only. (`ownerprofile`) | R0-09 |',
  ].join('\n');
  const rows = parseRulings(md);
  const d11 = resolveDecision('D-11', rows);
  assert.equal(d11.length, 1);
  assert.match(d11[0].text, /OWNER only/);
  const d12 = resolveDecision('D-12', rows);
  assert.equal(d12.length, 1, 'an id with only an open-question row keeps it');
  assert.equal(d12[0].unresolved, true, 'and it is marked unresolved');
});

// Codex review of #221 (P2): --check compares both generated files.
test('statusFilesCurrent requires both files and compares the Markdown too', async () => {
  const { statusFilesCurrent } = await import('../lib.mjs');
  const status = { summary: { packets: 1 }, packets: [{ id: 'A', status: 'todo' }], _generated: { main_sha: 'a'.repeat(40) } };
  const md = '# V1 status\n';
  const json = JSON.stringify(status);
  assert.equal(statusFilesCurrent({ jsonText: json, mdText: md, status, md }).current, true);
  assert.equal(statusFilesCurrent({ jsonText: json, mdText: null, status, md }).current, false);
  assert.equal(statusFilesCurrent({ jsonText: json, mdText: '# edited by hand\n', status, md }).current, false);
  assert.equal(statusFilesCurrent({ jsonText: null, mdText: md, status, md }).current, false);
});

// D-263 (Codex on #230, board P16): lanes take launch-track packets only, so the status names them apart.
test('buildStatus: each row carries its track, and ready_launch holds only launch-track ready packets', () => {
  const plan = {
    packets: [
      pk('L1', [], { track: 'launch', priority: 'P0' }), pk('L2', ['L1'], { track: 'launch' }), pk('F1', [], { track: 'follow-on', priority: 'P0' }),
      pk('F2', [], { track: 'follow-on' }), pk('U'),
    ],
    validation: { critical_path: [] },
  };
  const s = buildStatus({ plan, prior: null, commits: [], branches: null, mainSha: 'f'.repeat(40), mainDate: '2026-11-24', baseSha: null });
  // L1 unblocks L2, so it ranks first.
  assert.deepEqual(s.ready.map((r) => [r.id, r.track]), [['L1', 'launch'], ['F1', 'follow-on'], ['F2', 'follow-on'], ['U', null]]);
  assert.deepEqual(s.ready_launch.map((r) => r.id), ['L1']);
  assert.equal(s.summary.todo_with_dependencies_met_launch, 1);
  assert.deepEqual(s.summary.by_track, {
    launch: { done: 0, 'in-progress': 0, todo: 2, total: 2 },
    'follow-on': { done: 0, 'in-progress': 0, todo: 2, total: 2 },
    none: { done: 0, 'in-progress': 0, todo: 1, total: 1 },
  });
  assert.equal(s.packets.find((p) => p.id === 'F1').track, 'follow-on');
  const md = renderStatusMd(s);
  assert.match(md, /## Ready to start, launch track \(1; D-263\)/);
  assert.match(md, /\| 1 \| L1 \|/);
  // the follow-on packets are counted, not listed as ready for a lane
  assert.doesNotMatch(md.split('## Ready to start, launch track')[1].split('\n## ')[0], /F1/);
  assert.match(md, /Follow-on packets ready \(D-263; only on the owner's assignment\): 2/);
  assert.match(md, /\| launch \| 0 \| 0 \| 2 \| 2 \|/);
});

// D-319 / Q69 (P246 DOCS-CONTROL-ROOM-273): #273 is the active control room (#80 archived at 2,500 comments),
// with a rollover rule before the next 2,500-comment cap.
test('D-319/Q69: active control room is #273 with rollover rule across bundle and operational docs', async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

  const plan = { packets: [pk('SAMPLE', [], { decisions: ['D-222'] })], r0_register: [], fixture_prefix_table: [] };
  const rulings = [{ id: 'D-222', line: 1, heading: 'Standing', text: 'standing rule' }];
  const b = buildBundle({
    plan,
    packetId: 'SAMPLE',
    rulings,
    statusById: {},
    fileExists: () => true,
    mainSha: 'a'.repeat(40),
    statusSource: 'V1-STATUS.json',
  });
  const prohibitedJoined = b.task.prohibited_scope.join('\n');
  assert.match(prohibitedJoined, /issue #273/, 'buildBundle prohibited_scope must name #273');
  assert.ok(
    b.excluded.sources.some((s) => /#273/.test(s.source)),
    'buildBundle excluded.sources must name #273',
  );

  const rolloverDocs = [
    'CLAUDE.md',
    'AGENTS.md',
    'docs/development/agent-memory/README.md',
    'docs/development/agent-memory/CHECKLISTS.md',
    'docs/development/agent-memory/WAVE-RUNBOOK.md',
    'docs/development/agent-memory/OWNER-QUESTION-FORMAT.md',
    'docs/development/agent-memory/PACKET-WORKER-BRIEF.md',
    'docs/development/agent-memory/SECOND-ACCOUNT-SETUP.md',
  ];
  for (const rel of rolloverDocs) {
    const text = readFileSync(resolve(repoRoot, rel), 'utf8');
    assert.match(text, /#273/, `${rel} must name #273 as the active control room`);
    assert.match(text, /2,350/, `${rel} must document the 2,350-comment rollover threshold`);
    assert.doesNotMatch(
      text,
      /issues\/80\/comments|gh issue (view|comment) 80|Post (a )?(CLAIM|RETURN|PROGRESS|HANDOFF|\"CLAIM <ID>\") on (issue )?#80|Issue #80 is the control room/i,
      `${rel} must not contain stale operational instructions pointing to archived #80`,
    );
  }
  for (const rel of ['CLAUDE.md', 'AGENTS.md', 'docs/development/agent-memory/README.md']) {
    const text = readFileSync(resolve(repoRoot, rel), 'utf8');
    assert.match(text, /scripts\/agent-memory\/lib\.mjs/, `${rel} rollover checklist must include scripts/agent-memory/lib.mjs`);
  }
  const measurement = readFileSync(resolve(repoRoot, 'docs/development/agent-memory/MEASUREMENT.md'), 'utf8');
  assert.match(measurement, /#273/, 'MEASUREMENT.md must reference #273');
});

