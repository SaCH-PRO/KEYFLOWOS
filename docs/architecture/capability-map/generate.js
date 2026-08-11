#!/usr/bin/env node
/* eslint-disable */
/**
 * KEY Capability Map generator.
 *
 * Mines the two authoritative capability sources already in the repo:
 *   - apps/server/src/modules/ai/flow-tool-registry.ts                          (FLOW_TOOLS — the governed executables)
 *   - apps/server/src/modules/key-cortex/key-cortex-capability-registry.service.ts (declared module capabilities)
 *
 * Projects them onto a business-function taxonomy, derives a target execution
 * MODE (agentic / assisted / assisted+approval / human-gated) per capability from
 * the tool's family + risk tier (+ cortex requiresApproval), resolves the UI
 * surface from each tool's CI-enforced manualEquivalentRoute, and emits three
 * views of one model:
 *   - key-capability-map.seed.json  (machine-loadable seed for the M0 capability model)
 *   - KEY_CAPABILITY_MAP.md         (human-readable coverage map + gap register)
 *   - key-capability-map.html       (browsable, colour-coded operator console)
 *
 * Pure derivation from source — no LLM, no guessing. Re-runnable; regenerate
 * whenever the registries change:  node docs/architecture/capability-map/generate.js
 */
const fs = require('fs');
const path = require('path');

const REPO = process.env.REPO_ROOT || path.resolve(__dirname, '../../..');
const AI = path.join(REPO, 'apps/server/src/modules/ai/flow-tool-registry.ts');
const CORTEX = path.join(REPO, 'apps/server/src/modules/key-cortex/key-cortex-capability-registry.service.ts');
const OUT = process.env.OUT_DIR || __dirname;

// ───────────────────────────────────────────────────────────── extract
function extractTools() {
  const src = fs.readFileSync(AI, 'utf8');
  const body = src.slice(src.indexOf('export const FLOW_TOOLS'));
  const re = /name:\s*'((?:[^'\\]|\\.)*)',\s*\n\s*description:\s*'((?:[^'\\]|\\.)*)',\s*\n\s*family:\s*'(\w+)',\s*\n\s*riskLevel:\s*'(\w+)',\s*\n\s*riskTier:\s*(\d)/g;
  const ms = [...body.matchAll(re)];
  return ms.map((m, i) => {
    const chunk = body.slice(m.index, i + 1 < ms.length ? ms[i + 1].index : body.length);
    const route = chunk.match(/manualEquivalentRoute:\s*'((?:[^'\\]|\\.)*)'/);
    return { name: m[1], description: m[2].replace(/\\'/g, "'"), family: m[3], riskLevel: m[4], riskTier: Number(m[5]), route: route ? route[1] : '/app' };
  });
}
function extractCaps() {
  const src = fs.readFileSync(CORTEX, 'utf8');
  const mods = [...src.matchAll(/module:\s*'(\w+)'/g)];
  const acts = [...src.matchAll(/name:\s*'((?:[^'\\]|\\.)*)',\s*\n\s*description:\s*'((?:[^'\\]|\\.)*)'/g)];
  const modAt = (idx) => { let m = null; for (const mm of mods) { if (mm.index < idx) m = mm[1]; else break; } return m; };
  return acts.map((m, i) => {
    const chunk = src.slice(m.index, i + 1 < acts.length ? acts[i + 1].index : src.length);
    const appr = chunk.match(/requiresApproval:\s*(true|false)/);
    return { module: modAt(m.index), name: m[1], description: m[2].replace(/\\'/g, "'"), requiresApproval: appr ? appr[1] === 'true' : false };
  }).filter(c => c.module);
}

// ───────────────────────────────────────────────────────────── taxonomy
const DOMAINS = [
  { id: 'sales_crm',  label: 'Sales & CRM',                   routes: ['crm','call-tasks','onboarding'], modules: ['crm'] },
  { id: 'marketing',  label: 'Marketing & Content',           routes: ['marketing','seo','content-ops','social'], modules: ['content','social'] },
  { id: 'commerce',   label: 'Commerce & Fulfillment',        routes: ['commerce','store','procurement','inventory','marketplace'], modules: ['commerce'] },
  { id: 'finance',    label: 'Finance & Accounting',          routes: ['finance','payments','expenses','retainers'], modules: ['finance'] },
  { id: 'operations', label: 'Operations & Delivery',         routes: ['projects','automations','time-tracking','structure','blueprint'], modules: ['flow','autopilot','projects'] },
  { id: 'scheduling', label: 'Scheduling & Bookings',         routes: ['bookings','calendar'], modules: ['bookings','temporal'] },
  { id: 'support',    label: 'Support & Communications',      routes: ['helpdesk','key-inbox','community'], modules: ['communications','inbox','notifications'] },
  { id: 'legal_gov',  label: 'Legal, Contracts & Governance', routes: ['contracts','governance-flow','evidence','approvals','portal','document-intelligence'], modules: [] },
  { id: 'analytics',  label: 'Analytics & Strategy',          routes: ['reports','goals','command-center','key','keyflow-command','performance'], modules: ['analytics','intelligence','genome','activity'] },
  { id: 'people_hr',  label: 'People & HR',                   routes: ['payroll'], modules: [] },
  { id: 'assets',     label: 'Assets & Documents',            routes: ['assets'], modules: [] },
  { id: 'admin',      label: 'Admin & Settings',              routes: ['settings'], modules: ['settings'] },
];
const routePrefix = (r) => (r || '/app').split('/').slice(0, 3).join('/');
const domainForRoute = (r) => { const seg = routePrefix(r).split('/')[2] || ''; const d = DOMAINS.find(dm => dm.routes.includes(seg)); return d ? d.id : 'admin'; };
const domainForModule = (mod) => (DOMAINS.find(d => d.modules.includes(mod)) || { id: 'admin' }).id;

// ───────────────────────────────────────────────────────────── mode derivation
function toolMode(t) {
  if (t.family === 'read') return 'agentic';
  if (t.riskTier >= 4) return 'human_gated';
  if (t.riskTier === 3) return 'assisted_approval';
  if (t.family === 'organize' && t.riskTier === 1) return 'agentic';
  return 'assisted';
}
function capMode(c) {
  if (c.requiresApproval) return 'assisted_approval';
  if (/^(get|list|search|find|analyze|fetch|read|show|summar)/.test(c.name)) return 'agentic';
  return 'assisted';
}

// ───────────────────────────────────────────────────────────── curated target gaps
const TARGETS = {
  sales_crm:  [['Web lead enrichment / prospecting', ['enrich','prospect']], ['Predictive lead scoring', ['lead scor','score lead','scoring']], ['Sales pipeline forecasting', ['forecast']]],
  marketing:  [['Campaign attribution / ROI', ['attribution']], ['Audience segmentation', ['segment']], ['Ad-spend optimization', ['ad spend','ad-spend','adspend']]],
  commerce:   [['Demand forecasting / reorder point', ['reorder','demand forecast']], ['Dynamic pricing', ['dynamic pric']], ['Supplier risk scoring', ['supplier risk','vendor risk']]],
  finance:    [['Cash-flow forecasting', ['cash flow','cashflow','cash-flow']], ['Dunning / collections sequencing', ['dunning','collections']], ['Multi-currency / FX handling', ['currency','fx ']], ['Tax filing preparation', ['tax fil','tax return','tax prep']]],
  operations: [['Capacity / resource planning', ['capacity']], ['SLA monitoring', ['sla']]],
  scheduling: [['No-show prediction', ['no-show','no show','noshow']], ['Smart rescheduling', ['reschedul']]],
  support:    [['Sentiment / escalation detection', ['sentiment','escalat']], ['Auto-triage & routing', ['triage']], ['KB answer synthesis', ['knowledge base','knowledge-base','kb answer']]],
  legal_gov:  [['Contract redlining / clause-risk analysis', ['redlin','clause']], ['Obligation extraction & tracking', ['obligation']], ['Renewal-risk analysis', ['renewal risk','renewal-risk']]],
  analytics:  [['Anomaly detection', ['anomaly']], ['Natural-language KPI Q&A', ['natural language','nl query','kpi q']], ['Cohort / retention analysis', ['cohort','retention']]],
  people_hr:  [['Payroll tax filing', ['payroll tax']], ['Performance-review synthesis', ['performance review','review synthesis']], ['PTO / shift optimization', ['pto','shift optim']]],
  assets:     [['Asset depreciation / lifecycle', ['depreciat']], ['License-renewal tracking', ['license renew','licence renew']]],
  admin:      [['Anomalous-access / audit alerting', ['audit alert','anomalous access']]],
};
const GAP_WHY = {
  'Ad-spend optimization':'Close the loop from spend to conversion; agentic reallocation.',
  'Dynamic pricing':'Margin/velocity-aware pricing; high-risk so gated.',
  'Supplier risk scoring':'Score vendors on reliability before commitment.',
  'Tax filing preparation':'Assemble filings; execution stays human-gated by law.',
  'SLA monitoring':'Catch breach risk before it happens.',
  'KB answer synthesis':'Deflect support volume with grounded answers.',
  'Renewal-risk analysis':'Flag contracts at churn/renewal risk early.',
  'Anomaly detection':'Surface metric anomalies with no human watching.',
  'Natural-language KPI Q&A':'Ask the business a question in plain language.',
  'Payroll tax filing':'Thinnest domain; compliance-heavy.',
  'Performance-review synthesis':'Aggregate signals into review drafts.',
  'PTO / shift optimization':'Balance coverage against staff availability.',
  'Asset depreciation / lifecycle':'Track book value and lifecycle events.',
  'License-renewal tracking':'Never miss a renewal.',
  'Anomalous-access / audit alerting':'Detect unusual admin access.',
};
const proposedMode = (l) => /pricing|tax fil|payroll tax/i.test(l) ? 'human_gated'
  : /monitor|detection|scoring|risk|Q&A|synthesis|tracking|alerting|optimization/i.test(l) ? 'agentic' : 'assisted';

// ───────────────────────────────────────────────────────────── build model
function buildModel() {
  const tools = extractTools();
  const caps = extractCaps();
  const haystack = [...tools.map(t => (t.name + ' ' + t.description).toLowerCase()), ...caps.map(c => (c.name + ' ' + c.description).toLowerCase())].join(' \n ');
  const model = { domains: [] };

  for (const d of DOMAINS) {
    const dTools = tools.filter(t => domainForRoute(t.route) === d.id).map(t => ({ name: t.name, description: t.description, family: t.family, riskTier: t.riskTier, mode: toolMode(t), route: routePrefix(t.route), fullRoute: t.route }));
    const dCaps = caps.filter(c => domainForModule(c.module) === d.id).map(c => ({ name: c.name, description: c.description, module: c.module, requiresApproval: c.requiresApproval, mode: capMode(c) }));
    const gaps = (TARGETS[d.id] || []).filter(([, kws]) => !kws.some(k => haystack.includes(k))).map(([l]) => l);
    const covered = (TARGETS[d.id] || []).filter(([, kws]) => kws.some(k => haystack.includes(k))).map(([l]) => l);
    const modeCounts = {};
    [...dTools, ...dCaps].forEach(x => { modeCounts[x.mode] = (modeCounts[x.mode] || 0) + 1; });
    model.domains.push({ id: d.id, label: d.label, toolCount: dTools.length, capCount: dCaps.length, modeCounts, uiSurfaces: [...new Set(dTools.map(t => t.route))].sort(), targetsTotal: (TARGETS[d.id] || []).length, targetsCovered: covered.length, gaps, tools: dTools, capabilities: dCaps });
  }
  const totalTargets = model.domains.reduce((s, d) => s + d.targetsTotal, 0);
  const totalCovered = model.domains.reduce((s, d) => s + d.targetsCovered, 0);
  const totalModeCounts = {};
  model.domains.forEach(d => Object.entries(d.modeCounts).forEach(([m, n]) => totalModeCounts[m] = (totalModeCounts[m] || 0) + n));
  model.summary = { domains: model.domains.length, flowTools: tools.length, cortexCapabilities: caps.length, targetsTotal: totalTargets, targetsCovered: totalCovered, coveragePct: Math.round((totalCovered / totalTargets) * 100), modeCounts: totalModeCounts };
  return model;
}

// ───────────────────────────────────────────────────────────── shared view meta
const MODES = ['agentic', 'assisted', 'assisted_approval', 'human_gated'];
const MLABEL = { agentic: 'Agentic', assisted: 'Assisted', assisted_approval: 'Assisted + Approval', human_gated: 'Human-gated' };

// ───────────────────────────────────────────────────────────── markdown
function writeMarkdown(model) {
  const ICON = { agentic: '🟢', assisted: '🔵', assisted_approval: '🟡', human_gated: '🔴' };
  const modeStr = (c) => Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${ICON[k]} ${n}`).join(' ');
  const dominant = (c) => (Object.entries(c).sort((a, b) => b[1] - a[1])[0] || ['assisted'])[0];
  let out = ''; const p = (s = '') => { out += s + '\n'; };
  const S = model.summary;

  p('# KEY Capability Map');
  p();
  p('> **Auto-generated** by `generate.js` from the two authoritative capability sources in the repo. Do not hand-edit — regenerate instead (`node docs/architecture/capability-map/generate.js`).');
  p();
  p(`Projected from **${S.flowTools} governed flow tools** (\`ai/flow-tool-registry.ts\`) and **${S.cortexCapabilities} declared cortex capabilities** (\`key-cortex/key-cortex-capability-registry.service.ts\`) onto a **${S.domains}-domain** business-function taxonomy.`);
  p();
  p('This file is three artifacts in one: a **coverage map** (what KEY can do, by domain), a **mode assignment** (manual vs assisted vs agentic, per capability), and a **gap register** (what a complete business OS still needs). Seed for the M0 capability model — `key-capability-map.seed.json` is the machine-loadable form.');
  p();
  p('## What this answers');
  p();
  p('- **Do we cover the whole business?** Coverage by domain, below.');
  p('- **Manual, smart, or AI — per capability?** The *mode* is **derived, not chosen**: from each tool\'s `family` + `riskTier` (+ cortex `requiresApproval`). Money movement, destructive, and irreversible actions pin to **Human-gated** by rule — "KEY may create intelligence, but not authority."');
  p('- **What integration + UI does each mode imply?** See the legend. The **manual UI already exists** for every tool via its CI-enforced `manualEquivalentRoute`; assisted reuses the existing approval queue; only agentic needs the new Operator Console.');
  p('- **What\'s missing?** The gap register — curated target capabilities with no covering tool or capability anywhere in either registry.');
  p();
  p('## Mode legend — derived, governance-bounded');
  p();
  p('| Mode | Meaning | Integration | UI surface |');
  p('|---|---|---|---|');
  p('| 🟢 **Agentic** | AI acts autonomously (read-only / low-risk) | Orchestrator + Operator Console | Goal / chat surface + console |');
  p('| 🔵 **Assisted** | AI drafts/acts, human-reviewable | Automation + draft review | Product screen + inline suggestions |');
  p('| 🟡 **Assisted + Approval** | AI proposes, execution gated | Approval queue (`AiApprovalItem`) | Product screen + approval queue |');
  p('| 🔴 **Human-gated** | Money / destructive / irreversible | Manual execution; AI proposes only | Product screen (human decision) |');
  p();
  p('**Derivation rules** (`generate.js`): `read` family → 🟢 Agentic · `organize`@tier1 → 🟢 · tier 4 → 🔴 Human-gated · tier 3 or cortex `requiresApproval` → 🟡 Assisted+Approval · everything else (`draft`/`crud`/`execute`@tier1-2) → 🔵 Assisted.');
  p();
  p('## Coverage summary');
  p();
  p(`Across **${S.domains} domains**: 🟢 ${S.modeCounts.agentic || 0} agentic · 🔵 ${S.modeCounts.assisted || 0} assisted · 🟡 ${S.modeCounts.assisted_approval || 0} assisted+approval · 🔴 ${S.modeCounts.human_gated || 0} human-gated. Target-capability coverage: **${S.targetsCovered}/${S.targetsTotal} (${S.coveragePct}%)**.`);
  p();
  p('| Domain | Tools | Cortex caps | UI surfaces | Target coverage | Mode mix |');
  p('|---|--:|--:|--:|:--:|---|');
  for (const d of model.domains) p(`| **${d.label}** | ${d.toolCount} | ${d.capCount} | ${d.uiSurfaces.length} | ${d.targetsTotal ? `${d.targetsCovered}/${d.targetsTotal}` : '—'} | ${modeStr(d.modeCounts)} |`);
  p();
  p('## Gap register');
  p();
  p('Curated target capabilities a complete business OS should cover, keyword-checked against **every** tool and capability in both registries. Only *unmatched* targets are listed — the concrete "build or synthesize" backlog. Proposed mode is what the capability *would* take once built.');
  p();
  p('| Domain | Missing capability | Proposed mode | Why it matters |');
  p('|---|---|---|---|');
  let gapCount = 0;
  for (const d of model.domains) for (const g of d.gaps) { gapCount++; p(`| ${d.label} | ${g} | ${ICON[proposedMode(g)]} ${MLABEL[proposedMode(g)]} | ${GAP_WHY[g] || ''} |`); }
  p();
  p(`**${gapCount} gaps** across ${model.domains.filter(d => d.gaps.length).length} domains. Thinnest domains: **People & HR**, **Assets & Documents**, **Admin & Settings**.`);
  p();
  p('## How to read this into the roadmap');
  p();
  p('- **The map is a target, not a build queue.** Preload the *map* to 100%; preload *tools* broadly (already done). Instantiate *skills/agents* only for seed-worthy bets or accumulated evidence.');
  p('- **M0** loads `key-capability-map.seed.json` as the initial capability model. Every skill/agent registered later declares which capability id(s) it covers → coverage becomes computable and self-reported.');
  p('- **Mode is the governance contract.** 🔴 Human-gated capabilities must never be promoted to autonomous, regardless of evidence.');
  p('- **UI is mostly done.** Manual = existing routes; Assisted = existing approval queue; only the Operator Console (agentic) is net-new.');
  p();
  p('## Per-domain detail');
  p();
  for (const d of model.domains) {
    p(`### ${d.label}`);
    p();
    p(`Dominant mode: ${ICON[dominant(d.modeCounts)]} **${MLABEL[dominant(d.modeCounts)]}** · ${d.toolCount} tools · ${d.capCount} cortex capabilities`);
    p();
    p(d.uiSurfaces.length ? `**UI surfaces:** ${d.uiSurfaces.map(s => `\`${s}\``).join(' · ')}` : '**UI surfaces:** _(cortex-only, no dedicated flow tools)_');
    p();
    if (d.gaps.length) { p(`**Gaps:** ${d.gaps.map(g => `⛔ ${g}`).join(' · ')}`); p(); }
    const rows = [...d.tools].sort((a, b) => a.mode.localeCompare(b.mode) || a.name.localeCompare(b.name));
    if (rows.length) {
      p('<details><summary>' + rows.length + ' governed tools</summary>');
      p();
      p('| Tool | Family | Tier | Mode | Manual route |');
      p('|---|---|:--:|---|---|');
      for (const t of rows) p(`| \`${t.name}\` | ${t.family} | ${t.riskTier} | ${ICON[t.mode]} ${MLABEL[t.mode]} | \`${t.fullRoute}\` |`);
      p();
      p('</details>');
      p();
    }
  }
  fs.writeFileSync(path.join(OUT, 'KEY_CAPABILITY_MAP.md'), out);
  return out.length;
}

// ───────────────────────────────────────────────────────────── html
function writeHtml(model) {
  const payload = {
    summary: model.summary,
    domains: model.domains.map(d => ({ id: d.id, label: d.label, toolCount: d.toolCount, capCount: d.capCount, uiSurfaces: d.uiSurfaces, targetsTotal: d.targetsTotal, targetsCovered: d.targetsCovered, modeCounts: d.modeCounts, gaps: d.gaps,
      tools: d.tools.map(t => ({ name: t.name, family: t.family, riskTier: t.riskTier, mode: t.mode, route: t.fullRoute })),
      caps: d.capabilities.map(c => ({ name: c.name, mode: c.mode, requiresApproval: c.requiresApproval })) })),
    gaps: [].concat(...model.domains.map(d => d.gaps.map(g => ({ domain: d.label, cap: g, mode: proposedMode(g), why: GAP_WHY[g] || '' })))),
  };
  const html = HTML_TEMPLATE.replace('__PAYLOAD__', JSON.stringify(payload))
    .replace(/__TOTAL__/g, String(payload.summary.flowTools + payload.summary.cortexCapabilities))
    .replace('__COVPCT__', String(payload.summary.coveragePct));
  fs.writeFileSync(path.join(OUT, 'key-capability-map.html'), html);
  return html.length;
}

const HTML_TEMPLATE = String.raw`<title>KEY Capability Map</title>
<style>
  :root{
    --bg:#F3F3F7;--surface:#FFFFFF;--surface-2:#FAFAFC;--surface-3:#F1F1F6;--border:#E4E4EC;--border-strong:#D3D3DE;
    --ink:#1A1A24;--ink-soft:#54546A;--ink-faint:#8888A0;--accent:#4F46E5;--accent-soft:#EEEDFC;
    --agentic:#15A34A;--assisted:#2563EB;--approval:#C2740A;--gated:#D92D20;--gated-bg:#FBE9E7;
    --shadow:0 1px 2px rgba(20,20,40,.05),0 8px 24px -12px rgba(20,20,40,.14);
    --mono:ui-monospace,"SF Mono","SFMono-Regular","JetBrains Mono","Cascadia Code",Menlo,Consolas,monospace;
    --sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
  :root:not([data-theme="light"]){@media (prefers-color-scheme:dark){
    --bg:#0D0D13;--surface:#15151E;--surface-2:#1A1A25;--surface-3:#20202E;--border:#282836;--border-strong:#36364A;
    --ink:#E9E9F2;--ink-soft:#A2A2BC;--ink-faint:#66667E;--accent:#8983FF;--accent-soft:#211F3A;
    --agentic:#34D399;--assisted:#60A5FA;--approval:#FBBF24;--gated:#F87171;--gated-bg:#2E1614;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 12px 32px -14px rgba(0,0,0,.6);
  }}
  :root[data-theme="dark"]{
    --bg:#0D0D13;--surface:#15151E;--surface-2:#1A1A25;--surface-3:#20202E;--border:#282836;--border-strong:#36364A;
    --ink:#E9E9F2;--ink-soft:#A2A2BC;--ink-faint:#66667E;--accent:#8983FF;--accent-soft:#211F3A;
    --agentic:#34D399;--assisted:#60A5FA;--approval:#FBBF24;--gated:#F87171;--gated-bg:#2E1614;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 12px 32px -14px rgba(0,0,0,.6);
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);line-height:1.5;-webkit-font-smoothing:antialiased;font-size:15px}
  .wrap{max-width:1120px;margin:0 auto;padding:clamp(20px,4vw,56px) clamp(16px,4vw,40px) 96px}
  .eyebrow{font-family:var(--mono);font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-faint)}
  h1{font-size:clamp(30px,5vw,46px);line-height:1.02;letter-spacing:-.03em;margin:.35em 0 .2em;text-wrap:balance;font-weight:680}
  h1 .key{color:var(--accent)}
  .lede{color:var(--ink-soft);max-width:66ch;font-size:15.5px}
  .lede code{font-family:var(--mono);font-size:.86em;background:var(--surface-3);padding:.08em .38em;border-radius:5px}
  header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap}
  .toggle{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft);background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:7px 14px;cursor:pointer;white-space:nowrap}
  .toggle:hover{border-color:var(--border-strong);color:var(--ink)}
  .toggle:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .strip{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin:32px 0 10px;box-shadow:var(--shadow)}
  .stat{background:var(--surface);padding:18px 20px}
  .stat .n{font-family:var(--mono);font-size:clamp(26px,4vw,38px);font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1}
  .stat .l{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint);margin-top:8px}
  .stat.accent .n{color:var(--accent)}
  @media(max-width:640px){.strip{grid-template-columns:repeat(2,1fr)}}
  .totalbar-wrap{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px 20px;box-shadow:var(--shadow);margin-bottom:34px}
  .totalbar-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px;flex-wrap:wrap;gap:8px}
  .totalbar-head .t{font-family:var(--mono);font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint)}
  .bar{display:flex;height:22px;border-radius:6px;overflow:hidden;background:var(--surface-3)}
  .bar>span{display:block}
  .legendrow{display:flex;gap:18px;flex-wrap:wrap;margin-top:12px}
  .lgi{display:flex;align-items:center;gap:8px;font-size:12.5px;color:var(--ink-soft);font-family:var(--mono)}
  .dot{width:11px;height:11px;border-radius:3px;flex:none}
  h2{font-size:13px;font-family:var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--ink-faint);margin:44px 0 16px;font-weight:600;display:flex;align-items:center;gap:12px}
  h2::after{content:"";height:1px;background:var(--border);flex:1}
  .legend{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
  @media(max-width:860px){.legend{grid-template-columns:repeat(2,1fr)}}
  @media(max-width:480px){.legend{grid-template-columns:1fr}}
  .lc{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:15px 16px;border-top:3px solid var(--m)}
  .lc .h{display:flex;align-items:center;gap:9px;font-weight:640;font-size:14.5px}
  .lc .h .d{width:12px;height:12px;border-radius:4px;background:var(--m)}
  .lc .rule{font-family:var(--mono);font-size:11px;color:var(--ink-faint);margin-top:9px;line-height:1.5}
  .lc .meta{margin-top:11px;font-size:12.5px;color:var(--ink-soft)}
  .lc .meta b{color:var(--ink);font-weight:600}
  .filters{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 4px}
  .chip{font-family:var(--mono);font-size:12px;letter-spacing:.04em;padding:7px 13px;border-radius:999px;cursor:pointer;background:var(--surface);border:1px solid var(--border);color:var(--ink-soft);display:flex;align-items:center;gap:7px}
  .chip:hover{border-color:var(--border-strong);color:var(--ink)}
  .chip[aria-pressed="true"]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
  .chip .d{width:9px;height:9px;border-radius:3px}
  .chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .matrix{display:flex;flex-direction:column;gap:10px;margin-top:16px}
  .row{background:var(--surface);border:1px solid var(--border);border-radius:13px;box-shadow:var(--shadow);overflow:hidden;transition:opacity .2s}
  .row.dim{opacity:.32}
  .rhead{display:grid;grid-template-columns:minmax(0,1.7fr) 88px 1fr 132px 26px;align-items:center;gap:16px;padding:15px 18px;cursor:pointer;width:100%;background:none;border:0;text-align:left;color:inherit;font:inherit}
  .rhead:hover{background:var(--surface-2)}
  .rhead:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
  .dname{font-weight:640;font-size:16px;letter-spacing:-.01em;min-width:0}
  .dname .surf{font-family:var(--mono);font-size:11px;color:var(--ink-faint);font-weight:400;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .counts{font-family:var(--mono);font-size:12px;color:var(--ink-soft);font-variant-numeric:tabular-nums;text-align:right;line-height:1.35}
  .counts b{color:var(--ink);font-weight:600}
  .cov{display:flex;flex-direction:column;gap:5px}
  .cov .meter{height:7px;border-radius:4px;background:var(--surface-3);overflow:hidden}
  .cov .meter>span{display:block;height:100%;background:var(--accent);border-radius:4px}
  .cov .cl{font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faint)}
  .caret{justify-self:end;color:var(--ink-faint);transition:transform .2s;font-size:12px}
  .row.open .caret{transform:rotate(90deg)}
  @media(max-width:760px){.rhead{grid-template-columns:1fr 60px 22px;grid-template-areas:"n n c" "b b b" "ct cov cov";row-gap:12px}.dname{grid-area:n}.dbar{grid-area:b}.counts{grid-area:ct;text-align:left}.cov{grid-area:cov}.caret{grid-area:c}}
  .dbar{display:flex;height:16px;border-radius:5px;overflow:hidden;background:var(--surface-3);min-width:60px}
  .dbar>span{display:block}
  .body{display:none;padding:4px 18px 20px;border-top:1px solid var(--border);background:var(--surface-2)}
  .row.open .body{display:block}
  .grp{margin-top:16px}
  .grp .gh{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft);display:flex;align-items:center;gap:8px;margin-bottom:9px}
  .grp .gh .d{width:9px;height:9px;border-radius:3px}
  .tools{display:flex;flex-wrap:wrap;gap:6px}
  .tt{font-family:var(--mono);font-size:11.5px;padding:4px 9px;border-radius:6px;background:var(--surface-3);border:1px solid var(--border);color:var(--ink-soft);display:inline-flex;align-items:center;gap:7px}
  .tt .tier{font-size:9.5px;color:var(--ink-faint);border:1px solid var(--border-strong);border-radius:3px;padding:0 4px}
  .gaps{display:flex;flex-direction:column;gap:6px;margin-top:6px}
  .gap{display:flex;align-items:center;gap:10px;font-size:13px;background:var(--gated-bg);border-radius:8px;padding:8px 12px}
  .gap .x{color:var(--gated);font-family:var(--mono);font-weight:700}
  .gap .pm{margin-left:auto;font-family:var(--mono);font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;padding:2px 8px;border-radius:999px;color:#fff}
  .gaptable{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:13px;overflow:hidden;box-shadow:var(--shadow);font-size:13.5px}
  .gaptable th{font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint);text-align:left;padding:12px 16px;background:var(--surface-2);border-bottom:1px solid var(--border);font-weight:600}
  .gaptable td{padding:12px 16px;border-bottom:1px solid var(--border);vertical-align:top}
  .gaptable tr:last-child td{border-bottom:0}
  .gaptable td.d{font-family:var(--mono);font-size:12px;color:var(--ink-soft);white-space:nowrap}
  .gaptable td.c{font-weight:600}
  .pill{font-family:var(--mono);font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;padding:2px 9px;border-radius:999px;color:#fff;white-space:nowrap}
  .gwrap{overflow-x:auto}
  .why{color:var(--ink-soft)}
  footer{margin-top:52px;padding-top:24px;border-top:1px solid var(--border);color:var(--ink-faint);font-size:13px}
  footer b{color:var(--ink-soft)}
  footer code{font-family:var(--mono);font-size:.85em;background:var(--surface-3);padding:.08em .38em;border-radius:5px;color:var(--ink-soft)}
  .note{background:var(--accent-soft);border:1px solid color-mix(in srgb,var(--accent) 25%,transparent);border-radius:11px;padding:14px 17px;margin:18px 0;font-size:13.5px;color:var(--ink-soft)}
  .note b{color:var(--ink)}
  @media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
<div class="wrap">
  <header>
    <div>
      <div class="eyebrow">KeyFlowOS · Governed Capability Substrate</div>
      <h1><span class="key">KEY</span> Capability Map</h1>
      <p class="lede">Every capability KEY has today, projected onto a business-function taxonomy and each assigned a <b>derived execution mode</b> — manual, assisted, or agentic. Mined directly from <code>flow-tool-registry.ts</code> and <code>key-cortex-capability-registry</code>. Mode is derived from risk tier and approval flags, never chosen: money and destructive actions stay human-gated by rule.</p>
    </div>
    <button class="toggle" id="tg" aria-label="Toggle colour theme">&#9680; Theme</button>
  </header>
  <div class="strip" id="strip"></div>
  <div class="totalbar-wrap">
    <div class="totalbar-head">
      <span class="t">Mode distribution — all __TOTAL__ capabilities</span>
      <span class="t" id="covpct"></span>
    </div>
    <div class="bar" id="totalbar"></div>
    <div class="legendrow" id="totlegend"></div>
  </div>
  <h2>Mode legend — derived, governance-bounded</h2>
  <div class="legend" id="legend"></div>
  <h2>Coverage by domain</h2>
  <div class="filters" id="filters"></div>
  <div class="matrix" id="matrix"></div>
  <h2>Gap register — build or synthesize</h2>
  <div class="note"><b>Read this as a target, not a build queue.</b> These are curated business capabilities with <i>no</i> covering tool or capability in either registry — keyword-checked against all __TOTAL__. Proposed mode is what each would take once built. Thinnest domains: <b>People &amp; HR</b>, <b>Assets &amp; Documents</b>, <b>Admin &amp; Settings</b>.</div>
  <div class="gwrap"><table class="gaptable" id="gaptable"></table></div>
  <footer>
    <p><b>Methodology.</b> Pure derivation from source — no LLM, no guessing. Tool mode: <code>read</code>&rarr;Agentic · <code>organize</code>@tier1&rarr;Agentic · tier&nbsp;4&rarr;Human-gated · tier&nbsp;3 or cortex <code>requiresApproval</code>&rarr;Assisted+Approval · else Assisted. Manual UI for every tool comes from its CI-enforced <code>manualEquivalentRoute</code>; assisted reuses the existing <code>AiApprovalItem</code> queue; only the agentic Operator Console is net-new.</p>
    <p style="margin-top:10px">Seed for the <b>M0 capability model</b> — the machine-loadable form is <code>key-capability-map.seed.json</code>. Regenerate with <code>node docs/architecture/capability-map/generate.js</code>.</p>
  </footer>
</div>
<script id="data" type="application/json">__PAYLOAD__</script>
<script>
(function(){
  var D=JSON.parse(document.getElementById('data').textContent);
  var MODES=['agentic','assisted','assisted_approval','human_gated'];
  var MLABEL={agentic:'Agentic',assisted:'Assisted',assisted_approval:'Assisted + Approval',human_gated:'Human-gated'};
  var CVAR={agentic:'--agentic',assisted:'--assisted',assisted_approval:'--approval',human_gated:'--gated'};
  function color(m){return 'var('+CVAR[m]+')';}
  var RULE={agentic:"read family / organize @ tier 1",assisted:"draft · crud · execute @ tier 1-2",assisted_approval:"tier 3 or requiresApproval",human_gated:"tier 4 — money / destructive"};
  var META={agentic:{i:'Orchestrator + Operator Console',u:'Goal / chat surface'},assisted:{i:'Automation + draft review',u:'Screen + inline suggestions'},assisted_approval:{i:'Approval queue (AiApprovalItem)',u:'Screen + approval queue'},human_gated:{i:'Manual execution',u:'Screen (human decides)'}};
  var S=D.summary,strip=document.getElementById('strip');
  [['Business domains',S.domains],['Governed flow tools',S.flowTools],['Cortex capabilities',S.cortexCapabilities],['Target coverage',S.coveragePct+'%']].forEach(function(x,i){var el=document.createElement('div');el.className='stat'+(i===3?' accent':'');el.innerHTML='<div class="n">'+x[1]+'</div><div class="l">'+x[0]+'</div>';strip.appendChild(el);});
  document.getElementById('covpct').textContent=S.targetsCovered+' / '+S.targetsTotal+' target capabilities covered';
  var totalAll=MODES.reduce(function(a,m){return a+(S.modeCounts[m]||0);},0),tb=document.getElementById('totalbar');
  MODES.forEach(function(m){var n=S.modeCounts[m]||0;if(!n)return;var s=document.createElement('span');s.style.width=(n/totalAll*100)+'%';s.style.background=color(m);s.title=MLABEL[m]+': '+n;tb.appendChild(s);});
  var tl=document.getElementById('totlegend');
  MODES.forEach(function(m){var n=S.modeCounts[m]||0;var el=document.createElement('span');el.className='lgi';el.innerHTML='<span class="dot" style="background:'+color(m)+'"></span>'+MLABEL[m]+' <b style="color:var(--ink);margin-left:2px">'+n+'</b>';tl.appendChild(el);});
  var lg=document.getElementById('legend');
  MODES.forEach(function(m){var c=document.createElement('div');c.className='lc';c.style.setProperty('--m',color(m));c.innerHTML='<div class="h"><span class="d"></span>'+MLABEL[m]+'</div><div class="rule">'+RULE[m]+'</div><div class="meta"><b>Integrate:</b> '+META[m].i+'<br><b>UI:</b> '+META[m].u+'</div>';lg.appendChild(c);});
  var active=null,filters=document.getElementById('filters');
  function mkChip(m,label,gaps){var c=document.createElement('button');c.className='chip';c.setAttribute('aria-pressed','false');if(gaps)c.dataset.gaps='1';c.innerHTML=(m?'<span class="d" style="background:'+color(m)+'"></span>':'')+label;c.onclick=function(){setFilter(m,c);};return c;}
  var allChip=mkChip(null,'All');allChip.setAttribute('aria-pressed','true');filters.appendChild(allChip);
  var chipEls={all:allChip};
  MODES.forEach(function(m){var c=mkChip(m,MLABEL[m]);chipEls[m]=c;filters.appendChild(c);});
  var gapsChip=mkChip(null,'⛔ Gaps only',true);filters.appendChild(gapsChip);chipEls.gaps=gapsChip;
  function setFilter(m,el){var isGaps=el&&el.dataset.gaps;var target=isGaps?'gaps':m;active=(active===target)?null:target;Object.keys(chipEls).forEach(function(k){chipEls[k].setAttribute('aria-pressed','false');});if(active===null)allChip.setAttribute('aria-pressed','true');else (isGaps?gapsChip:chipEls[m]).setAttribute('aria-pressed','true');apply();}
  function apply(){document.querySelectorAll('.row').forEach(function(row){var dm=row.dataset,show=true;if(active==='gaps')show=Number(dm.gaps)>0;else if(active)show=Number(dm['m_'+active])>0;row.classList.toggle('dim',!show);row.querySelectorAll('.grp').forEach(function(g){if(active&&active!=='gaps'&&g.dataset.mode){g.style.display=g.dataset.mode===active?'':'none';}else g.style.display='';});});}
  var matrix=document.getElementById('matrix');
  D.domains.forEach(function(d){
    var total=MODES.reduce(function(a,m){return a+(d.modeCounts[m]||0);},0);
    var row=document.createElement('div');row.className='row';row.dataset.gaps=d.gaps.length;MODES.forEach(function(m){row.dataset['m_'+m]=d.modeCounts[m]||0;});
    var seg=MODES.map(function(m){var n=d.modeCounts[m]||0;return n?'<span style="width:'+(n/total*100)+'%;background:'+color(m)+'" title="'+MLABEL[m]+': '+n+'"></span>':'';}).join('');
    var cov=d.targetsTotal?Math.round(d.targetsCovered/d.targetsTotal*100):null;
    var surf=d.uiSurfaces.length?d.uiSurfaces.join('  ·  '):'cortex-only';
    var head=document.createElement('button');head.className='rhead';head.setAttribute('aria-expanded','false');
    head.innerHTML='<div class="dname">'+d.label+'<div class="surf">'+surf+'</div></div><div class="dbar">'+seg+'</div><div class="counts"><b>'+d.toolCount+'</b> tools · <b>'+d.capCount+'</b> caps'+(d.gaps.length?'<br><span style="color:var(--gated)">⛔ '+d.gaps.length+' gap'+(d.gaps.length>1?'s':'')+'</span>':'')+'</div><div class="cov">'+(cov!==null?'<div class="meter"><span style="width:'+cov+'%"></span></div><div class="cl">'+d.targetsCovered+'/'+d.targetsTotal+' target · '+cov+'%</div>':'<div class="cl">no targets</div>')+'</div><div class="caret">▶</div>';
    head.onclick=function(){var open=row.classList.toggle('open');head.setAttribute('aria-expanded',open?'true':'false');};
    row.appendChild(head);
    var body=document.createElement('div');body.className='body';
    MODES.forEach(function(mode){
      var ts=d.tools.filter(function(t){return t.mode===mode;}),cs=d.caps.filter(function(c){return c.mode===mode;});
      if(!ts.length&&!cs.length)return;
      var g=document.createElement('div');g.className='grp';g.dataset.mode=mode;
      var chips=ts.map(function(t){return '<span class="tt" title="'+t.route+'"><span class="tier">T'+t.riskTier+'</span>'+t.name+'</span>';}).concat(cs.map(function(c){return '<span class="tt" title="cortex capability"><span class="tier" style="opacity:.6">cx</span>'+c.name+'</span>';})).join('');
      g.innerHTML='<div class="gh"><span class="d" style="background:'+color(mode)+'"></span>'+MLABEL[mode]+' · '+(ts.length+cs.length)+'</div><div class="tools">'+chips+'</div>';
      body.appendChild(g);
    });
    if(d.gaps.length){var gg=document.createElement('div');gg.className='grp';gg.innerHTML='<div class="gh" style="color:var(--gated)"><span class="d" style="background:var(--gated)"></span>Missing · '+d.gaps.length+'</div><div class="gaps">'+d.gaps.map(function(x){var pm=D.gaps.find(function(gp){return gp.cap===x;});pm=pm?pm.mode:'assisted';var mm=pm==='human_gated'?'human_gated':pm==='agentic'?'agentic':'assisted';return '<div class="gap"><span class="x">✗</span>'+x+'<span class="pm" style="background:'+color(mm)+'">'+(pm==='human_gated'?'gated':pm)+'</span></div>';}).join('')+'</div>';body.appendChild(gg);}
    row.appendChild(body);matrix.appendChild(row);
  });
  var gt=document.getElementById('gaptable');
  gt.innerHTML='<thead><tr><th>Domain</th><th>Missing capability</th><th>Proposed mode</th><th>Why it matters</th></tr></thead><tbody>'+D.gaps.map(function(g){var mode=g.mode==='human_gated'?'human_gated':g.mode==='agentic'?'agentic':'assisted';return '<tr><td class="d">'+g.domain+'</td><td class="c">'+g.cap+'</td><td><span class="pill" style="background:'+color(mode)+'">'+MLABEL[mode]+'</span></td><td class="why">'+g.why+'</td></tr>';}).join('')+'</tbody>';
  document.getElementById('tg').onclick=function(){var r=document.documentElement,cur=r.getAttribute('data-theme');var next=cur?(cur==='dark'?'light':'dark'):(matchMedia('(prefers-color-scheme:dark)').matches?'light':'dark');r.setAttribute('data-theme',next);};
})();
</script>`;

// ───────────────────────────────────────────────────────────── run
const model = buildModel();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'key-capability-map.seed.json'), JSON.stringify(model, null, 2));
const mdLen = writeMarkdown(model);
const htmlLen = writeHtml(model);
console.log('KEY Capability Map generated:');
console.log('  summary:', JSON.stringify(model.summary));
console.log('  seed JSON  ->', path.join(OUT, 'key-capability-map.seed.json'));
console.log('  markdown   ->', path.join(OUT, 'KEY_CAPABILITY_MAP.md'), `(${mdLen} bytes)`);
console.log('  html       ->', path.join(OUT, 'key-capability-map.html'), `(${htmlLen} bytes)`);
