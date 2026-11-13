const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { pathToFileURL } = require('node:url');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const REPO = path.resolve(process.env.KF_H1_REPO || process.cwd());
const OUT = path.resolve(process.env.KF_H1_OUTPUT || process.cwd());
const WEB = path.join(REPO, 'apps/web/src');
let client;
function loadActualTs(file) {
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const m = new Module(file, module); m.filename = file; m.paths = module.paths;
  m.require = name => {
    if (name === '@/lib/api') return { apiGet: () => { throw Error('No API expected'); } };
    if (name === '@/lib/api/handoff-monitor') return client;
    if (name === '@/lib/utils') return { cn: (...args) => args.filter(Boolean).join(' ') };
    if (name === 'lucide-react') return { ExternalLink: () => null };
    return require(name);
  };
  m._compile(js, file); return m.exports;
}
(async () => {
  const { projectHandoffs, viewOf, redactCredentials } = await import(pathToFileURL(path.join(REPO, 'scripts/agent-control/lib/handoff-projector.mjs')).href);
  const fixture = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts/agent-control/fixtures/handoff-irp177.json'), 'utf8'));
  // Deliberately fake marker satisfying the projector's exact known pattern.
  // Not a credential and never sent to any network service.
  const fakeToken = 'ghp_' + 'X'.repeat(36);
  assert.equal(redactCredentials(fakeToken).text, '[REDACTED:github-token]');
  const changed = fixture.comments.find(c => c.id === 6229520428);
  changed.body = changed.body.replace(/^reviewer_model:.*$/m, `reviewer_model: ${fakeToken}`);
  const snapshot = projectHandoffs(fixture.comments, { observedAt: '2026-10-17T20:00:00.000Z' });
  const view = viewOf(snapshot, { task: 6229439023 });
  const message = view.task.chain.find(c => c.comment_id === 6229520428);
  client = loadActualTs(path.join(WEB, 'lib/api/handoff-monitor.ts'));
  const { TaskDetail } = loadActualTs(path.join(WEB, 'app/admin/mission-control/handoffs/_components/handoff-panels.tsx'));
  const html = renderToStaticMarkup(React.createElement(TaskDetail, { task: view.task }));
  const output = {
    outcome: 'DEFECT_REPRODUCED',
    fakeTokenPattern: 'ghp_ followed by 36 literal X characters (noncredential)',
    field: 'RETURN reviewer_model',
    bodyRedacted: !message.body.includes(fakeToken),
    redactionsCount: message.redactions,
    messageStillUsable: message.usable,
    projectedClaimedModelContainsUnredactedToken: message.provenance.claimed_model === fakeToken,
    apiViewContainsUnredactedToken: JSON.stringify(view).includes(fakeToken),
    renderedTaskDetailContainsUnredactedToken: html.includes(fakeToken),
    note: 'Exact-head projector and actual TaskDetail/panels/client source, transpiled and React server rendered. Only icons and styling helper stubbed. Synthetic replacement of a fixture field; no real secret, API or production access.',
  };
  assert.ok(output.bodyRedacted);
  assert.ok(output.messageStillUsable);
  assert.ok(output.projectedClaimedModelContainsUnredactedToken);
  assert.ok(output.apiViewContainsUnredactedToken);
  assert.ok(output.renderedTaskDetailContainsUnredactedToken);
  fs.writeFileSync(path.join(OUT, 'metadata-redaction-result.json'), JSON.stringify(output, null, 2));
  fs.writeFileSync(path.join(OUT, 'metadata-redaction.html'), html);
  console.log(JSON.stringify(output, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
