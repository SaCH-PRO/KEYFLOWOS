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
 * the tool's family + risk tier (+ cortex requiresApproval), and resolves the UI
 * surface from each tool's CI-enforced manualEquivalentRoute.
 *
 * Every domain also carries a curated set of TARGET capabilities. Each target is
 * either ACTIVE (a real tool/capability covers it today) or PLANNED (declared with
 * a full build spec — mode, risk tier, what it composes from, UI surface, evaluator
 * gate). The model therefore reaches 100% DECLARED coverage while reporting the
 * honest 53% ACTIVE (executable-today) coverage separately.
 *
 * Emits four views of one model:
 *   - key-capability-map.seed.json                              (canonical machine-readable model)
 *   - KEY_CAPABILITY_MAP.md                                     (human-readable coverage map + build backlog)
 *   - key-capability-map.html                                   (browsable, colour-coded operator console)
 *   - apps/server/src/modules/ai/capability-map/capability-map.seed.ts (typed seed the server imports at runtime)
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
const SERVER_SEED_TS = path.join(REPO, 'apps/server/src/modules/ai/capability-map/capability-map.seed.ts');

// ───────────────────────────────────────────────────────────── extract
/**
 * Parse FLOW_TOOLS.
 *
 * BOTH QUOTE STYLES, AND A COUNT CHECK.
 *
 * The original regex accepted only SINGLE-quoted descriptions. A tool whose
 * description contains an apostrophe is written with double quotes —
 *
 *   description: "Turn off a contact's customer-portal access…",
 *
 * — and was silently dropped. Four were, when this was audited:
 * payments_refund_charge, portal_revoke_access, suppliers_list_products and
 * suppliers_create_product_from_supplier. 282 declared, 278 parsed, no warning.
 *
 * A capability map that quietly omits capabilities is the one failure this
 * artifact cannot afford, so the miscount now throws rather than under-reports.
 * The count is taken from a deliberately dumber pattern — a bare `name:` line —
 * so the check does not share the assumption it is checking.
 */
const STR = String.raw`(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")`;
/**
 * Whitespace, and any line comments in between. The fields of a tool are not
 * always adjacent — payments_refund_charge carries four lines of comment
 * between `riskLevel` and `riskTier` explaining why it is tier 3, and a
 * strictly-consecutive pattern dropped it for that.
 */
const GAP = String.raw`(?:\s|\/\/[^\n]*)*`;

function extractTools() {
  const src = fs.readFileSync(AI, 'utf8');
  const body = src.slice(src.indexOf('export const FLOW_TOOLS'));
  const re = new RegExp(
    String.raw`name:\s*${STR},${GAP}description:\s*${STR},${GAP}family:\s*'(\w+)',${GAP}riskLevel:\s*'(\w+)',${GAP}riskTier:\s*(\d)`,
    'g',
  );
  const ms = [...body.matchAll(re)];
  const tools = ms.map((m, i) => {
    const chunk = body.slice(m.index, i + 1 < ms.length ? ms[i + 1].index : body.length);
    const route = chunk.match(/manualEquivalentRoute:\s*'((?:[^'\\]|\\.)*)'/);
    const name = m[1] !== undefined ? m[1] : m[2];
    const description = (m[3] !== undefined ? m[3] : m[4]).replace(/\\'/g, "'").replace(/\\"/g, '"');
    return { name, description, family: m[5], riskLevel: m[6], riskTier: Number(m[7]), route: route ? route[1] : '/app' };
  });

  const declared = [...body.matchAll(/^\s*name: '[a-z0-9_]+',$/gm)].length;
  if (tools.length !== declared) {
    const got = new Set(tools.map((t) => t.name));
    const missed = [...body.matchAll(/^\s*name: '([a-z0-9_]+)',$/gm)].map((m) => m[1]).filter((n) => !got.has(n));
    throw new Error(
      `FLOW_TOOLS parse is incomplete: ${declared} declared, ${tools.length} parsed. ` +
        `Missing: ${missed.join(', ')}. Fix the extractor — do NOT let the map under-report.`,
    );
  }
  return tools;
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

// ───────────────────────────────────────────────────────────── curated targets
// Each domain's target capabilities. keyword list decides ACTIVE (covered by a
// real tool/capability) vs PLANNED (needs building). Every target that can be
// PLANNED must have a spec in PLANNED_SPECS below — the generator asserts this.
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

// Build specs for every target that a complete business OS should have. Present for
// ALL targets so a target that regresses to PLANNED always carries a spec. Mode here
// is authoritative (it refines the coarse proposedMode heuristic). uiSurface is the
// existing app route the manual/assisted UI lives on; requiredTools are auto-derived
// from that surface's real tools at generation time.
const PLANNED_SPECS = {
  'Web lead enrichment / prospecting': { mode: 'agentic', riskTier: 1, uiSurface: '/app/crm', evaluator: 'Source-provenance + dedupe checks; enrichment-accuracy sample BLOCKING' },
  'Predictive lead scoring':           { mode: 'agentic', riskTier: 1, uiSurface: '/app/crm', evaluator: 'Backtest AUC vs historical conversions; drift monitor' },
  'Sales pipeline forecasting':        { mode: 'agentic', riskTier: 1, uiSurface: '/app/reports', evaluator: 'Backtest MAPE vs closed deals; confidence intervals' },
  'Campaign attribution / ROI':        { mode: 'agentic', riskTier: 1, uiSurface: '/app/marketing', evaluator: 'Attribution-model reproducibility; spend-to-revenue tie-out' },
  'Audience segmentation':             { mode: 'assisted', riskTier: 2, uiSurface: '/app/marketing', evaluator: 'Segment-stability test; PII-scope check BLOCKING' },
  'Ad-spend optimization':             { mode: 'assisted_approval', riskTier: 3, uiSurface: '/app/marketing', evaluator: 'Backtest reallocation vs 90d ROAS; budget-cap + policy BLOCKING' },
  'Demand forecasting / reorder point':{ mode: 'agentic', riskTier: 1, uiSurface: '/app/inventory', evaluator: 'Backtest forecast error; stockout/overstock cost check' },
  'Dynamic pricing':                   { mode: 'human_gated', riskTier: 4, uiSurface: '/app/commerce', evaluator: 'Margin-floor + price-change policy BLOCKING; human sign-off' },
  'Supplier risk scoring':             { mode: 'agentic', riskTier: 1, uiSurface: '/app/procurement', evaluator: 'Score reproducibility; source-provenance check' },
  'Cash-flow forecasting':             { mode: 'agentic', riskTier: 1, uiSurface: '/app/finance', evaluator: 'Backtest vs actual cash movements; scenario bounds' },
  'Dunning / collections sequencing':  { mode: 'assisted_approval', riskTier: 3, uiSurface: '/app/finance', evaluator: 'Tone/compliance screen; sequence dry-run BLOCKING' },
  'Multi-currency / FX handling':      { mode: 'assisted', riskTier: 2, uiSurface: '/app/finance', evaluator: 'Rate-source integrity; rounding/settlement tie-out' },
  'Tax filing preparation':            { mode: 'human_gated', riskTier: 4, uiSurface: '/app/finance', evaluator: 'Reconciliation ties to ledger; human + accountant sign-off' },
  'Capacity / resource planning':      { mode: 'assisted', riskTier: 2, uiSurface: '/app/projects', evaluator: 'Constraint-satisfaction test; over-allocation guard' },
  'SLA monitoring':                    { mode: 'agentic', riskTier: 1, uiSurface: '/app/projects', evaluator: 'Breach-threshold unit tests; false-positive ceiling' },
  'No-show prediction':                { mode: 'agentic', riskTier: 1, uiSurface: '/app/bookings', evaluator: 'Backtest precision/recall on historical no-shows' },
  'Smart rescheduling':                { mode: 'assisted', riskTier: 2, uiSurface: '/app/bookings', evaluator: 'Conflict-free guarantee test; notice-window policy' },
  'Sentiment / escalation detection':  { mode: 'agentic', riskTier: 1, uiSurface: '/app/helpdesk', evaluator: 'Labelled-set precision/recall; escalation-miss ceiling' },
  'Auto-triage & routing':             { mode: 'assisted', riskTier: 2, uiSurface: '/app/helpdesk', evaluator: 'Routing-accuracy suite; mis-route cost check' },
  'KB answer synthesis':               { mode: 'agentic', riskTier: 1, uiSurface: '/app/helpdesk', evaluator: 'Groundedness/citation check; hallucination guard BLOCKING' },
  'Contract redlining / clause-risk analysis': { mode: 'assisted', riskTier: 2, uiSurface: '/app/contracts', evaluator: 'Clause-detection recall; risk-rubric agreement' },
  'Obligation extraction & tracking':  { mode: 'agentic', riskTier: 1, uiSurface: '/app/contracts', evaluator: 'Extraction precision/recall; deadline-coverage check' },
  'Renewal-risk analysis':             { mode: 'agentic', riskTier: 1, uiSurface: '/app/contracts', evaluator: 'Backtest vs historical renew/churn outcomes' },
  'Anomaly detection':                 { mode: 'agentic', riskTier: 1, uiSurface: '/app/reports', evaluator: 'Precision/recall on labelled anomalies; alert-noise ceiling' },
  'Natural-language KPI Q&A':          { mode: 'agentic', riskTier: 1, uiSurface: '/app/reports', evaluator: 'Query-to-metric accuracy suite; refuse-when-unknown check BLOCKING' },
  'Cohort / retention analysis':       { mode: 'agentic', riskTier: 1, uiSurface: '/app/reports', evaluator: 'Cohort-definition reproducibility; retention-math tie-out' },
  'Payroll tax filing':                { mode: 'human_gated', riskTier: 4, uiSurface: '/app/payroll', evaluator: 'Withholding recomputation matches; human + compliance sign-off' },
  'Performance-review synthesis':      { mode: 'assisted', riskTier: 2, uiSurface: '/app/performance', evaluator: 'Bias/fairness screen; source-attribution check' },
  'PTO / shift optimization':          { mode: 'assisted', riskTier: 2, uiSurface: '/app/structure', evaluator: 'Coverage-constraint satisfaction; labour-rule check' },
  'Asset depreciation / lifecycle':    { mode: 'assisted', riskTier: 2, uiSurface: '/app/assets', evaluator: 'Depreciation schedule matches method; ledger tie-out' },
  'License-renewal tracking':          { mode: 'agentic', riskTier: 1, uiSurface: '/app/assets', evaluator: 'Renewal-date extraction accuracy; reminder-lead-time check' },
  'Anomalous-access / audit alerting': { mode: 'agentic', riskTier: 1, uiSurface: '/app/settings', evaluator: 'Detection precision on known-bad patterns; alert-noise ceiling' },
};

const WHY = {
  'Web lead enrichment / prospecting':'Fill thin inbound leads with firmographic + contact data before outreach.',
  'Predictive lead scoring':'Rank leads by conversion likelihood so effort goes where it pays.',
  'Sales pipeline forecasting':'Project pipeline to closed revenue with confidence bounds.',
  'Campaign attribution / ROI':'Tie spend to conversions across channels.',
  'Audience segmentation':'Group contacts for targeted messaging.',
  'Ad-spend optimization':'Close the loop from spend to conversion; reallocation moves budget so it stays approval-gated.',
  'Demand forecasting / reorder point':'Forecast demand and trigger reorders before stockout.',
  'Dynamic pricing':'Margin/velocity-aware pricing directly affects revenue; must stay human-decided.',
  'Supplier risk scoring':'Score vendors on reliability/financials before commitment.',
  'Cash-flow forecasting':'Project runway and cash position forward.',
  'Dunning / collections sequencing':'Chase overdue invoices on a compliant cadence.',
  'Multi-currency / FX handling':'Handle non-home-currency invoices and settlement.',
  'Tax filing preparation':'Assemble filings; submission stays human-gated by law.',
  'Capacity / resource planning':'Match staff/resource capacity to committed work.',
  'SLA monitoring':'Catch SLA breach risk before it happens.',
  'No-show prediction':'Predict likely no-shows to overbook or confirm proactively.',
  'Smart rescheduling':'Rebook conflicts without double-booking.',
  'Sentiment / escalation detection':'Flag angry/at-risk conversations for fast handling.',
  'Auto-triage & routing':'Route tickets to the right queue automatically.',
  'KB answer synthesis':'Deflect support volume with grounded, cited answers.',
  'Contract redlining / clause-risk analysis':'Surface risky clauses against a playbook.',
  'Obligation extraction & tracking':'Pull obligations and deadlines out of contracts.',
  'Renewal-risk analysis':'Flag contracts at churn/renewal risk early.',
  'Anomaly detection':'Surface metric anomalies with no human watching dashboards.',
  'Natural-language KPI Q&A':'Ask the business a question in plain language.',
  'Cohort / retention analysis':'Measure retention by cohort over time.',
  'Payroll tax filing':'Thinnest domain; compliance-heavy, submission human-gated.',
  'Performance-review synthesis':'Aggregate performance signals into review drafts a human edits.',
  'PTO / shift optimization':'Balance coverage against staff availability.',
  'Asset depreciation / lifecycle':'Track book value and lifecycle events.',
  'License-renewal tracking':'Never miss a license/contract renewal.',
  'Anomalous-access / audit alerting':'Detect unusual admin access; security posture.',
};

// ───────────────────────────────────────────────────────────── build model
function buildModel() {
  const tools = extractTools();
  const caps = extractCaps();
  const allItems = [...tools.map(t => ({ name: t.name, text: (t.name + ' ' + t.description).toLowerCase(), mode: toolMode(t), route: t.route })),
                    ...caps.map(c => ({ name: c.name, text: (c.name + ' ' + c.description).toLowerCase(), mode: capMode(c), route: null }))];
  /**
   * ACTIVE IS DECIDED AGAINST THE EXECUTION SUBSTRATE ONLY.
   *
   * This used to match against `allItems` — flow tools AND cortex capabilities
   * merged into one haystack. ADR-0001, on this same branch, says "Flow is the
   * execution substrate, Cortex is advisory" — so a target whose only match was
   * a cortex entry got marked `active` while nothing could actually run it.
   *
   * Two shipped that way:
   *   Web lead enrichment / prospecting -> create_contact
   *   Cohort / retention analysis       -> get_cohort_retention
   * Both exist ONLY in key-cortex-capability-registry.service.ts. They lifted
   * the headline from 47% to 53%, which is the one number the whole artifact
   * exists to state honestly.
   *
   * Cortex still feeds the per-domain mode counts and capability census below;
   * it just no longer decides whether something is executable today.
   */
  const executable = allItems.filter(i => i.route !== null);
  const haystack = executable.map(i => i.text).join(' \n ');

  /**
   * Tools a planned capability composes from. MUST NOT come back empty.
   *
   * The first version returned [] whenever nothing routed to the spec's UI
   * surface, and "Anomalous-access / audit alerting" (uiSurface /app/settings)
   * shipped with `requiredTools: []` — a "full build spec" missing the single
   * field that says what it would be built out of.
   *
   * Three deterministic widening steps: the exact surface, then the domain,
   * then the registry's read-only tools as a floor. The completeness guard
   * below rejects an empty result, so this has to actually find something.
   */
  const suggestTools = (surface) => {
    let pool = tools.filter(t => routePrefix(t.route) === surface);
    if (pool.length < 2) pool = pool.concat(tools.filter(t => domainForRoute(t.route) === domainForRoute(surface) && routePrefix(t.route) !== surface));
    if (pool.length < 2) pool = pool.concat(tools.filter(t => t.family === 'read'));
    pool = [...new Map(pool.map(t => [t.name, t])).values()];
    pool.sort((a, b) => (a.family === 'read' ? 0 : 1) - (b.family === 'read' ? 0 : 1) || a.name.localeCompare(b.name));
    return pool.slice(0, 3).map(t => t.name);
  };

  const model = { domains: [] };
  const missingSpec = [];

  for (const d of DOMAINS) {
    const dTools = tools.filter(t => domainForRoute(t.route) === d.id).map(t => ({ name: t.name, description: t.description, family: t.family, riskTier: t.riskTier, mode: toolMode(t), route: routePrefix(t.route), fullRoute: t.route }));
    const dCaps = caps.filter(c => domainForModule(c.module) === d.id).map(c => ({ name: c.name, description: c.description, module: c.module, requiresApproval: c.requiresApproval, mode: capMode(c) }));

    const targets = (TARGETS[d.id] || []).map(([label, kws]) => {
      const active = kws.some(k => haystack.includes(k));
      const spec = PLANNED_SPECS[label];
      if (!active && !spec) missingSpec.push(label);
      if (active) {
        // `executable`, not `allItems` — coveredBy must name something that can
        // actually run, or "active" is a claim the substrate cannot honour.
        const covering = executable.find(i => kws.some(k => i.text.includes(k)));
        return { label, status: 'active', mode: covering ? covering.mode : 'assisted', riskTier: null, uiSurface: covering && covering.route ? routePrefix(covering.route) : null, requiredTools: [], evaluator: null, coveredBy: covering ? covering.name : null, why: WHY[label] || '' };
      }
      return { label, status: 'planned', mode: spec.mode, riskTier: spec.riskTier, uiSurface: spec.uiSurface, requiredTools: suggestTools(spec.uiSurface), evaluator: spec.evaluator, coveredBy: null, why: WHY[label] || '' };
    });

    const modeCounts = {};
    [...dTools, ...dCaps].forEach(x => { modeCounts[x.mode] = (modeCounts[x.mode] || 0) + 1; });
    model.domains.push({
      id: d.id, label: d.label, toolCount: dTools.length, capCount: dCaps.length, modeCounts,
      uiSurfaces: [...new Set(dTools.map(t => t.route))].sort(),
      targetsTotal: targets.length,
      targetsActive: targets.filter(t => t.status === 'active').length,
      targetsPlanned: targets.filter(t => t.status === 'planned').length,
      targets, tools: dTools, capabilities: dCaps,
    });
  }

  if (missingSpec.length) throw new Error('PLANNED target(s) without a build spec — add to PLANNED_SPECS: ' + missingSpec.join(', '));

  /**
   * The guard above only checked that a PLANNED_SPECS *entry existed*. It never
   * looked at what was in it — and `requiredTools` is not read from the spec at
   * all, it is derived by suggestTools(). So a planned capability could ship
   * with an empty toolset and this file would still claim every planned item
   * carries "a full build spec: mode, risk tier, the actual existing tools it
   * composes from, UI surface, and a deterministic evaluator gate".
   *
   * One did. This checks the five fields that sentence promises, on the built
   * object rather than on the spec, because the built object is what ships.
   *
   * Actives are checked too: an active target with no coveredBy is a target
   * nothing was found for, which would be a bug in the keyword match rather
   * than a real capability.
   */
  const REQUIRED_PLANNED_FIELDS = ['mode', 'riskTier', 'uiSurface', 'evaluator'];
  const incomplete = [];
  for (const d of model.domains) {
    for (const t of d.targets) {
      if (t.status === 'planned') {
        const missing = REQUIRED_PLANNED_FIELDS.filter(f => t[f] === null || t[f] === undefined || t[f] === '');
        if (!Array.isArray(t.requiredTools) || t.requiredTools.length === 0) missing.push('requiredTools');
        if (missing.length) incomplete.push(`${t.label} [${missing.join(', ')}]`);
      } else if (!t.coveredBy) {
        incomplete.push(`${t.label} [active but coveredBy is null]`);
      }
    }
  }
  if (incomplete.length) {
    throw new Error('Target(s) with an incomplete spec — 100% declared would be a fiction:\n  ' + incomplete.join('\n  '));
  }

  const sum = (f) => model.domains.reduce((s, d) => s + f(d), 0);
  const totalTargets = sum(d => d.targetsTotal), totalActive = sum(d => d.targetsActive), totalPlanned = sum(d => d.targetsPlanned);
  const totalModeCounts = {};
  model.domains.forEach(d => Object.entries(d.modeCounts).forEach(([m, n]) => totalModeCounts[m] = (totalModeCounts[m] || 0) + n));
  model.summary = {
    domains: model.domains.length, flowTools: tools.length, cortexCapabilities: caps.length,
    targetsTotal: totalTargets, targetsActive: totalActive, targetsPlanned: totalPlanned,
    activeCoveragePct: Math.round((totalActive / totalTargets) * 100),
    declaredCoveragePct: 100,
    modeCounts: totalModeCounts,
  };
  return model;
}

// ───────────────────────────────────────────────────────────── shared view meta
const MODES = ['agentic', 'assisted', 'assisted_approval', 'human_gated'];
const MLABEL = { agentic: 'Agentic', assisted: 'Assisted', assisted_approval: 'Assisted + Approval', human_gated: 'Human-gated' };

// ───────────────────────────────────────────────────────────── markdown
function writeMarkdown(model) {
  const ICON = { agentic: '🟢', assisted: '🔵', assisted_approval: '🟡', human_gated: '🔴' };
  const modeStr = (c) => Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${ICON[k]} ${n}`).join(' ');
  let out = ''; const p = (s = '') => { out += s + '\n'; };
  const S = model.summary;

  p('# KEY Capability Map');
  p();
  p('> **Auto-generated** by `generate.js` from the two authoritative capability sources in the repo. Do not hand-edit — regenerate instead (`node docs/architecture/capability-map/generate.js`).');
  p();
  p(`Projected from **${S.flowTools} governed flow tools** (\`ai/flow-tool-registry.ts\`) and **${S.cortexCapabilities} declared cortex capabilities** (\`key-cortex/key-cortex-capability-registry.service.ts\`) onto a **${S.domains}-domain** business-function taxonomy.`);
  p();
  p(`**Coverage: 100% declared · ${S.activeCoveragePct}% active.** Every target capability a complete business OS needs is now *declared* in the model (${S.targetsTotal}/${S.targetsTotal}). **${S.targetsActive}** are **active** (a real tool covers them today); **${S.targetsPlanned}** are **planned** — declared with a full build spec (mode, risk tier, what they compose from, UI surface, evaluator gate) but not yet executable. "Active" is the honest executable-today number; "declared" means the model is complete.`);
  p();
  p('This file is the human-readable view of `key-capability-map.seed.json`, the seed for the M0 capability model.');
  p();
  p('## What this answers');
  p();
  p('- **Do we cover the whole business?** 100% declared; per-domain active/planned split below.');
  p('- **Manual, smart, or AI — per capability?** The *mode* is **derived, not chosen** — from `family` + `riskTier` (+ cortex `requiresApproval`) for active items, and pinned per spec for planned ones. Money movement, destructive, and irreversible actions stay **Human-gated** by rule — "KEY may create intelligence, but not authority."');
  p('- **What integration + UI does each mode imply?** See the legend. The **manual UI already exists** for every tool via its CI-enforced `manualEquivalentRoute`; assisted reuses the existing approval queue; only agentic needs the new Operator Console.');
  p('- **What still needs building?** The **build backlog** — every planned capability with its spec.');
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
  p('## Coverage summary');
  p();
  p(`Across **${S.domains} domains**: 🟢 ${S.modeCounts.agentic || 0} agentic · 🔵 ${S.modeCounts.assisted || 0} assisted · 🟡 ${S.modeCounts.assisted_approval || 0} assisted+approval · 🔴 ${S.modeCounts.human_gated || 0} human-gated (across ${S.flowTools + S.cortexCapabilities} live capabilities).`);
  p();
  p('| Domain | Tools | Cortex caps | UI surfaces | Active | Planned | Declared | Mode mix |');
  p('|---|--:|--:|--:|:--:|:--:|:--:|---|');
  for (const d of model.domains) p(`| **${d.label}** | ${d.toolCount} | ${d.capCount} | ${d.uiSurfaces.length} | ${d.targetsActive}/${d.targetsTotal} | ${d.targetsPlanned} | 100% | ${modeStr(d.modeCounts)} |`);
  p();
  p('## Build backlog — planned capabilities');
  p();
  p('Every gap is now a **declared capability with a spec**. This is the concrete build order. Proposed mode is the governance contract each will inherit.');
  p();
  p('"Composes from" is **auto-derived, not hand-picked** — real registry tools, preferring the capability\'s own UI surface, then its domain, then read-only tools registry-wide. Read it as a verified-to-exist starting point, not a vetted design: what is guaranteed is that every tool named is real and the list is never empty, not that it is the right list.');
  p();
  p('| Domain | Capability | Mode | Tier | Composes from | UI surface | Evaluator gate |');
  p('|---|---|---|:--:|---|---|---|');
  let backlog = 0;
  for (const d of model.domains) for (const t of d.targets.filter(t => t.status === 'planned')) {
    backlog++;
    p(`| ${d.label} | ${t.label} | ${ICON[t.mode]} ${MLABEL[t.mode]} | ${t.riskTier} | ${t.requiredTools.map(x => `\`${x}\``).join(', ') || '—'} | \`${t.uiSurface}\` | ${t.evaluator} |`);
  }
  p();
  p(`**${backlog} planned capabilities.** Safe-to-build-first (🟢 agentic, read-only): the analytics/monitoring/detection items. Must-stay-human-gated (🔴): Dynamic pricing, Tax filing preparation, Payroll tax filing — declared, but never auto-promoted to autonomous.`);
  p();
  p('## How to read this into the roadmap');
  p();
  p('- **The map is a target, not a build queue.** Declared = the model is complete; active = what actually runs. Instantiate planned capabilities on evidence or a seed-worthy bet — not all at once.');
  p('- **M0** loads `key-capability-map.seed.json` as the initial capability model. Every skill/agent registered later declares which capability it covers → active coverage climbs from ' + S.activeCoveragePct + '% toward 100% as things ship.');
  p('- **Mode is the governance contract.** 🔴 Human-gated capabilities must never be promoted to autonomous, regardless of evidence.');
  p('- **UI is mostly done.** Manual = existing routes; Assisted = existing approval queue; only the Operator Console (agentic) is net-new.');
  p();
  p('## Per-domain detail');
  p();
  for (const d of model.domains) {
    p(`### ${d.label}`);
    p();
    p(`${d.toolCount} tools · ${d.capCount} cortex capabilities · **${d.targetsActive}/${d.targetsTotal} active**, ${d.targetsPlanned} planned`);
    p();
    p(d.uiSurfaces.length ? `**UI surfaces:** ${d.uiSurfaces.map(s => `\`${s}\``).join(' · ')}` : '**UI surfaces:** _(cortex-only, no dedicated flow tools)_');
    p();
    p('**Target capabilities:**');
    p();
    p('| Capability | Status | Mode | Detail |');
    p('|---|---|---|---|');
    for (const t of d.targets) {
      const detail = t.status === 'active' ? (t.coveredBy ? `covered by \`${t.coveredBy}\`` : 'covered') : `T${t.riskTier} · composes \`${t.requiredTools[0] || '—'}\`… · ${t.uiSurface}`;
      p(`| ${t.label} | ${t.status === 'active' ? '✅ active' : '🧩 planned'} | ${ICON[t.mode]} ${MLABEL[t.mode]} | ${detail} |`);
    }
    p();
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
    domains: model.domains.map(d => ({ id: d.id, label: d.label, toolCount: d.toolCount, capCount: d.capCount, uiSurfaces: d.uiSurfaces, targetsTotal: d.targetsTotal, targetsActive: d.targetsActive, targetsPlanned: d.targetsPlanned, modeCounts: d.modeCounts, targets: d.targets,
      tools: d.tools.map(t => ({ name: t.name, family: t.family, riskTier: t.riskTier, mode: t.mode, route: t.fullRoute })),
      caps: d.capabilities.map(c => ({ name: c.name, mode: c.mode, requiresApproval: c.requiresApproval })) })),
    backlog: [].concat(...model.domains.map(d => d.targets.filter(t => t.status === 'planned').map(t => ({ domain: d.label, cap: t.label, mode: t.mode, riskTier: t.riskTier, tools: t.requiredTools, ui: t.uiSurface, evaluator: t.evaluator, why: t.why })))),
  };
  const html = HTML_TEMPLATE.replace('__PAYLOAD__', JSON.stringify(payload))
    .replace(/__TOTAL__/g, String(payload.summary.flowTools + payload.summary.cortexCapabilities))
    .replace('__ACTIVEPCT__', String(payload.summary.activeCoveragePct));
  fs.writeFileSync(path.join(OUT, 'key-capability-map.html'), html);
  return html.length;
}

// ───────────────────────────────────────────────────────────── typed TS seed (server runtime)
function writeTsSeed(model) {
  const banner = '/* AUTO-GENERATED by docs/architecture/capability-map/generate.js — do not edit. Regenerate instead. */\n';
  const body = `import type { CapabilityModel } from './capability-map.types';\n\nexport const CAPABILITY_MAP_SEED: CapabilityModel = ${JSON.stringify(model, null, 2)};\n`;
  fs.mkdirSync(path.dirname(SERVER_SEED_TS), { recursive: true });
  fs.writeFileSync(SERVER_SEED_TS, banner + body);
  return (banner + body).length;
}

const HTML_TEMPLATE = String.raw`<title>KEY Capability Map</title>
<style>
  :root{
    --bg:#F3F3F7;--surface:#FFFFFF;--surface-2:#FAFAFC;--surface-3:#F1F1F6;--border:#E4E4EC;--border-strong:#D3D3DE;
    --ink:#1A1A24;--ink-soft:#54546A;--ink-faint:#8888A0;--accent:#4F46E5;--accent-soft:#EEEDFC;
    --agentic:#15A34A;--assisted:#2563EB;--approval:#C2740A;--gated:#D92D20;
    --planned:#7A5AF0;--planned-bg:#EFEBFB;
    --shadow:0 1px 2px rgba(20,20,40,.05),0 8px 24px -12px rgba(20,20,40,.14);
    --mono:ui-monospace,"SF Mono","SFMono-Regular","JetBrains Mono","Cascadia Code",Menlo,Consolas,monospace;
    --sans:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
  :root:not([data-theme="light"]){@media (prefers-color-scheme:dark){
    --bg:#0D0D13;--surface:#15151E;--surface-2:#1A1A25;--surface-3:#20202E;--border:#282836;--border-strong:#36364A;
    --ink:#E9E9F2;--ink-soft:#A2A2BC;--ink-faint:#66667E;--accent:#8983FF;--accent-soft:#211F3A;
    --agentic:#34D399;--assisted:#60A5FA;--approval:#FBBF24;--gated:#F87171;
    --planned:#A88BFF;--planned-bg:#221C3C;
    --shadow:0 1px 2px rgba(0,0,0,.3),0 12px 32px -14px rgba(0,0,0,.6);
  }}
  :root[data-theme="dark"]{
    --bg:#0D0D13;--surface:#15151E;--surface-2:#1A1A25;--surface-3:#20202E;--border:#282836;--border-strong:#36364A;
    --ink:#E9E9F2;--ink-soft:#A2A2BC;--ink-faint:#66667E;--accent:#8983FF;--accent-soft:#211F3A;
    --agentic:#34D399;--assisted:#60A5FA;--approval:#FBBF24;--gated:#F87171;
    --planned:#A88BFF;--planned-bg:#221C3C;
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
  .lede b{color:var(--ink)}
  header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;flex-wrap:wrap}
  .toggle{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-soft);background:var(--surface);border:1px solid var(--border);border-radius:999px;padding:7px 14px;cursor:pointer;white-space:nowrap}
  .toggle:hover{border-color:var(--border-strong);color:var(--ink)}
  .toggle:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .strip{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border:1px solid var(--border);border-radius:14px;overflow:hidden;margin:32px 0 10px;box-shadow:var(--shadow)}
  .stat{background:var(--surface);padding:18px 20px}
  .stat .n{font-family:var(--mono);font-size:clamp(24px,3.6vw,34px);font-weight:600;letter-spacing:-.02em;font-variant-numeric:tabular-nums;line-height:1}
  .stat .n .sub{font-size:.5em;color:var(--ink-faint);letter-spacing:0}
  .stat .l{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint);margin-top:8px}
  .stat.accent .n{color:var(--accent)}
  @media(max-width:640px){.strip{grid-template-columns:repeat(2,1fr)}}
  .covbar-wrap{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px 20px;box-shadow:var(--shadow);margin-bottom:14px}
  .covbar-head{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;flex-wrap:wrap;gap:8px}
  .covbar-head .t{font-family:var(--mono);font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-faint)}
  .covbar{display:flex;height:26px;border-radius:6px;overflow:hidden;background:var(--surface-3);font-family:var(--mono);font-size:11px}
  .covbar>span{display:flex;align-items:center;justify-content:center;color:#fff;white-space:nowrap;overflow:hidden}
  .covbar .active{background:var(--accent)}
  .covbar .planned{background:repeating-linear-gradient(45deg,var(--planned),var(--planned) 6px,transparent 6px,transparent 12px);color:var(--planned);border:1px dashed var(--planned)}
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
  .rhead{display:grid;grid-template-columns:minmax(0,1.7fr) 88px 1fr 150px 26px;align-items:center;gap:16px;padding:15px 18px;cursor:pointer;width:100%;background:none;border:0;text-align:left;color:inherit;font:inherit}
  .rhead:hover{background:var(--surface-2)}
  .rhead:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
  .dname{font-weight:640;font-size:16px;letter-spacing:-.01em;min-width:0}
  .dname .surf{font-family:var(--mono);font-size:11px;color:var(--ink-faint);font-weight:400;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .counts{font-family:var(--mono);font-size:12px;color:var(--ink-soft);font-variant-numeric:tabular-nums;text-align:right;line-height:1.35}
  .counts b{color:var(--ink);font-weight:600}
  .cov{display:flex;flex-direction:column;gap:5px}
  .cov .meter{height:7px;border-radius:4px;background:var(--surface-3);overflow:hidden;display:flex}
  .cov .meter>.a{display:block;height:100%;background:var(--accent)}
  .cov .meter>.p{display:block;height:100%;background:repeating-linear-gradient(45deg,var(--planned),var(--planned) 4px,transparent 4px,transparent 8px)}
  .cov .cl{font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-faint)}
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
  .planned-list{display:flex;flex-direction:column;gap:8px;margin-top:6px}
  .pcap{background:var(--planned-bg);border:1px dashed var(--planned);border-radius:9px;padding:10px 13px}
  .pcap .top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
  .pcap .nm{font-weight:640;font-size:13.5px}
  .pcap .pm{font-family:var(--mono);font-size:10px;letter-spacing:.05em;text-transform:uppercase;padding:2px 8px;border-radius:999px;color:#fff}
  .pcap .tier{font-family:var(--mono);font-size:10px;color:var(--planned);border:1px solid var(--planned);border-radius:4px;padding:1px 6px}
  .pcap .spec{font-family:var(--mono);font-size:11px;color:var(--ink-soft);margin-top:7px;line-height:1.55}
  .pcap .spec b{color:var(--ink)}
  .backlogtable{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--border);border-radius:13px;overflow:hidden;box-shadow:var(--shadow);font-size:13px}
  .backlogtable th{font-family:var(--mono);font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint);text-align:left;padding:12px 14px;background:var(--surface-2);border-bottom:1px solid var(--border);font-weight:600}
  .backlogtable td{padding:11px 14px;border-bottom:1px solid var(--border);vertical-align:top}
  .backlogtable tr:last-child td{border-bottom:0}
  .backlogtable td.d{font-family:var(--mono);font-size:11.5px;color:var(--ink-soft);white-space:nowrap}
  .backlogtable td.c{font-weight:600}
  .backlogtable code{font-family:var(--mono);font-size:11px;background:var(--surface-3);padding:.05em .35em;border-radius:4px;color:var(--ink-soft)}
  .pill{font-family:var(--mono);font-size:10px;letter-spacing:.05em;text-transform:uppercase;padding:2px 9px;border-radius:999px;color:#fff;white-space:nowrap}
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
      <p class="lede">Every capability a complete business OS needs, projected onto a business-function taxonomy and each assigned a <b>derived execution mode</b>. <b>100% declared</b> — the model is complete — with <b>__ACTIVEPCT__% active</b> (executable today) and the rest <b>planned</b>, each carrying a full build spec. Mined from <code>flow-tool-registry.ts</code> and <code>key-cortex-capability-registry</code>; money and destructive actions stay human-gated by rule.</p>
    </div>
    <button class="toggle" id="tg" aria-label="Toggle colour theme">&#9680; Theme</button>
  </header>
  <div class="strip" id="strip"></div>
  <div class="covbar-wrap">
    <div class="covbar-head"><span class="t">Target coverage — active vs planned</span><span class="t" id="covnum"></span></div>
    <div class="covbar" id="covbar"></div>
  </div>
  <div class="totalbar-wrap">
    <div class="totalbar-head"><span class="t">Mode distribution — all __TOTAL__ live capabilities</span></div>
    <div class="bar" id="totalbar"></div>
    <div class="legendrow" id="totlegend"></div>
  </div>
  <h2>Mode legend — derived, governance-bounded</h2>
  <div class="legend" id="legend"></div>
  <h2>Coverage by domain</h2>
  <div class="filters" id="filters"></div>
  <div class="matrix" id="matrix"></div>
  <h2>Build backlog — planned capabilities</h2>
  <div class="note"><b>Every gap is now a declared capability with a spec.</b> These are planned (not yet executable) — the concrete build order. Proposed mode is the governance contract each inherits; "composes from" lists real existing tools it can be built on. <b>Safe first:</b> the 🟢 read-only analytics/detection items. <b>Never auto-promoted:</b> 🔴 Dynamic pricing, Tax filing, Payroll tax.</div>
  <div class="gwrap"><table class="backlogtable" id="backlog"></table></div>
  <footer>
    <p><b>Methodology.</b> Pure derivation from source — no LLM, no guessing. Tool mode: <code>read</code>&rarr;Agentic · <code>organize</code>@tier1&rarr;Agentic · tier&nbsp;4&rarr;Human-gated · tier&nbsp;3 or cortex <code>requiresApproval</code>&rarr;Assisted+Approval · else Assisted. A target is <b>active</b> when a real tool/capability matches it, else <b>planned</b> with an authored spec. Manual UI comes from each tool's CI-enforced <code>manualEquivalentRoute</code>; assisted reuses <code>AiApprovalItem</code>; only the agentic Operator Console is net-new.</p>
    <p style="margin-top:10px">Seed for the <b>M0 capability model</b> — machine-readable form is <code>key-capability-map.seed.json</code>; the server imports the typed <code>capability-map.seed.ts</code>. Regenerate with <code>node docs/architecture/capability-map/generate.js</code>.</p>
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
  [['Business domains',S.domains,''],['Governed flow tools',S.flowTools,''],['Cortex capabilities',S.cortexCapabilities,''],['Declared coverage','100%',S.activeCoveragePct+'% active']].forEach(function(x,i){var el=document.createElement('div');el.className='stat'+(i===3?' accent':'');el.innerHTML='<div class="n">'+x[1]+(x[2]?' <span class="sub">'+x[2]+'</span>':'')+'</div><div class="l">'+x[0]+'</div>';strip.appendChild(el);});
  // coverage bar active vs planned
  var cb=document.getElementById('covbar');
  var a=document.createElement('span');a.className='active';a.style.width=(S.targetsActive/S.targetsTotal*100)+'%';a.textContent=S.targetsActive+' active';cb.appendChild(a);
  var pl=document.createElement('span');pl.className='planned';pl.style.width=(S.targetsPlanned/S.targetsTotal*100)+'%';pl.textContent=S.targetsPlanned+' planned';cb.appendChild(pl);
  document.getElementById('covnum').textContent=S.targetsActive+' / '+S.targetsTotal+' active · '+S.targetsPlanned+' planned · 100% declared';
  var totalAll=MODES.reduce(function(a,m){return a+(S.modeCounts[m]||0);},0),tb=document.getElementById('totalbar');
  MODES.forEach(function(m){var n=S.modeCounts[m]||0;if(!n)return;var s=document.createElement('span');s.style.width=(n/totalAll*100)+'%';s.style.background=color(m);s.title=MLABEL[m]+': '+n;tb.appendChild(s);});
  var tl=document.getElementById('totlegend');
  MODES.forEach(function(m){var n=S.modeCounts[m]||0;var el=document.createElement('span');el.className='lgi';el.innerHTML='<span class="dot" style="background:'+color(m)+'"></span>'+MLABEL[m]+' <b style="color:var(--ink);margin-left:2px">'+n+'</b>';tl.appendChild(el);});
  var lg=document.getElementById('legend');
  MODES.forEach(function(m){var c=document.createElement('div');c.className='lc';c.style.setProperty('--m',color(m));c.innerHTML='<div class="h"><span class="d"></span>'+MLABEL[m]+'</div><div class="rule">'+RULE[m]+'</div><div class="meta"><b>Integrate:</b> '+META[m].i+'<br><b>UI:</b> '+META[m].u+'</div>';lg.appendChild(c);});
  var active=null,filters=document.getElementById('filters');
  function mkChip(m,label,kind){var c=document.createElement('button');c.className='chip';c.setAttribute('aria-pressed','false');if(kind)c.dataset.kind=kind;c.innerHTML=(m?'<span class="d" style="background:'+color(m)+'"></span>':'')+label;c.onclick=function(){setFilter(m,c,kind);};return c;}
  var allChip=mkChip(null,'All');allChip.setAttribute('aria-pressed','true');filters.appendChild(allChip);
  var chipEls={all:allChip};
  MODES.forEach(function(m){var c=mkChip(m,MLABEL[m]);chipEls[m]=c;filters.appendChild(c);});
  var plannedChip=mkChip(null,'🧩 Planned only',' planned');filters.appendChild(plannedChip);chipEls.planned=plannedChip;
  function setFilter(m,el,kind){var target=kind?'planned':m;active=(active===target)?null:target;Object.keys(chipEls).forEach(function(k){chipEls[k].setAttribute('aria-pressed','false');});if(active===null)allChip.setAttribute('aria-pressed','true');else (kind?plannedChip:chipEls[m]).setAttribute('aria-pressed','true');apply();}
  function apply(){document.querySelectorAll('.row').forEach(function(row){var dm=row.dataset,show=true;if(active==='planned')show=Number(dm.planned)>0;else if(active)show=Number(dm['m_'+active])>0;row.classList.toggle('dim',!show);row.querySelectorAll('.grp').forEach(function(g){if(active&&active!=='planned'&&g.dataset.mode){g.style.display=g.dataset.mode===active?'':'none';}else if(active==='planned'&&g.dataset.grp){g.style.display=g.dataset.grp==='planned'?'':'none';}else g.style.display='';});});}
  var matrix=document.getElementById('matrix');
  D.domains.forEach(function(d){
    var total=MODES.reduce(function(a,m){return a+(d.modeCounts[m]||0);},0);
    var row=document.createElement('div');row.className='row';row.dataset.planned=d.targetsPlanned;MODES.forEach(function(m){row.dataset['m_'+m]=d.modeCounts[m]||0;});
    var seg=MODES.map(function(m){var n=d.modeCounts[m]||0;return n?'<span style="width:'+(n/total*100)+'%;background:'+color(m)+'" title="'+MLABEL[m]+': '+n+'"></span>':'';}).join('');
    var actPct=Math.round(d.targetsActive/d.targetsTotal*100),plPct=100-actPct;
    var surf=d.uiSurfaces.length?d.uiSurfaces.join('  ·  '):'cortex-only';
    var head=document.createElement('button');head.className='rhead';head.setAttribute('aria-expanded','false');
    head.innerHTML='<div class="dname">'+d.label+'<div class="surf">'+surf+'</div></div><div class="dbar">'+seg+'</div><div class="counts"><b>'+d.toolCount+'</b> tools · <b>'+d.capCount+'</b> caps'+(d.targetsPlanned?'<br><span style="color:var(--planned)">🧩 '+d.targetsPlanned+' planned</span>':'')+'</div><div class="cov"><div class="meter"><span class="a" style="width:'+actPct+'%"></span><span class="p" style="width:'+plPct+'%"></span></div><div class="cl">'+d.targetsActive+'/'+d.targetsTotal+' active · 100% decl</div></div><div class="caret">▶</div>';
    head.onclick=function(){var open=row.classList.toggle('open');head.setAttribute('aria-expanded',open?'true':'false');};
    row.appendChild(head);
    var body=document.createElement('div');body.className='body';
    MODES.forEach(function(mode){
      var ts=d.tools.filter(function(t){return t.mode===mode;}),cs=d.caps.filter(function(c){return c.mode===mode;});
      if(!ts.length&&!cs.length)return;
      var g=document.createElement('div');g.className='grp';g.dataset.mode=mode;g.dataset.grp='active';
      var chips=ts.map(function(t){return '<span class="tt" title="'+t.route+'"><span class="tier">T'+t.riskTier+'</span>'+t.name+'</span>';}).concat(cs.map(function(c){return '<span class="tt" title="cortex capability"><span class="tier" style="opacity:.6">cx</span>'+c.name+'</span>';})).join('');
      g.innerHTML='<div class="gh"><span class="d" style="background:'+color(mode)+'"></span>'+MLABEL[mode]+' · '+(ts.length+cs.length)+'</div><div class="tools">'+chips+'</div>';
      body.appendChild(g);
    });
    var planned=d.targets.filter(function(t){return t.status==='planned';});
    if(planned.length){var gg=document.createElement('div');gg.className='grp';gg.dataset.grp='planned';
      gg.innerHTML='<div class="gh" style="color:var(--planned)"><span class="d" style="background:var(--planned)"></span>Planned · '+planned.length+'</div><div class="planned-list">'+planned.map(function(t){
        return '<div class="pcap"><div class="top"><span class="nm">'+t.label+'</span><span class="pm" style="background:'+color(t.mode)+'">'+MLABEL[t.mode]+'</span><span class="tier">T'+t.riskTier+'</span></div><div class="spec"><b>Composes from:</b> '+(t.requiredTools.length?t.requiredTools.join(', '):'—')+' &nbsp;·&nbsp; <b>UI:</b> '+t.uiSurface+'<br><b>Gate:</b> '+t.evaluator+'</div></div>';
      }).join('')+'</div>';
      body.appendChild(gg);}
    row.appendChild(body);matrix.appendChild(row);
  });
  var bt=document.getElementById('backlog');
  bt.innerHTML='<thead><tr><th>Domain</th><th>Capability</th><th>Mode</th><th>Tier</th><th>Composes from</th><th>UI</th><th>Evaluator gate</th></tr></thead><tbody>'+D.backlog.map(function(g){return '<tr><td class="d">'+g.domain+'</td><td class="c">'+g.cap+'</td><td><span class="pill" style="background:'+color(g.mode)+'">'+MLABEL[g.mode]+'</span></td><td class="d">T'+g.riskTier+'</td><td>'+(g.tools.length?g.tools.map(function(t){return '<code>'+t+'</code>';}).join(' '):'—')+'</td><td class="d">'+g.ui+'</td><td class="why">'+g.evaluator+'</td></tr>';}).join('')+'</tbody>';
  document.getElementById('tg').onclick=function(){var r=document.documentElement,cur=r.getAttribute('data-theme');var next=cur?(cur==='dark'?'light':'dark'):(matchMedia('(prefers-color-scheme:dark)').matches?'light':'dark');r.setAttribute('data-theme',next);};
})();
</script>`;

// ───────────────────────────────────────────────────────────── run
const model = buildModel();
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'key-capability-map.seed.json'), JSON.stringify(model, null, 2));
const mdLen = writeMarkdown(model);
const htmlLen = writeHtml(model);
const tsLen = writeTsSeed(model);
console.log('KEY Capability Map generated:');
console.log('  summary:', JSON.stringify(model.summary));
console.log('  seed JSON  ->', path.join(OUT, 'key-capability-map.seed.json'));
console.log('  markdown   ->', path.join(OUT, 'KEY_CAPABILITY_MAP.md'), `(${mdLen} bytes)`);
console.log('  html       ->', path.join(OUT, 'key-capability-map.html'), `(${htmlLen} bytes)`);
console.log('  ts seed    ->', SERVER_SEED_TS, `(${tsLen} bytes)`);
