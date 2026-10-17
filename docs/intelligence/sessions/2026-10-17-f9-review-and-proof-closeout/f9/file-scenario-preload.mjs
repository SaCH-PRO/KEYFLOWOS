import fs from 'node:fs';
// Review-only adapter: a short file path crosses the process boundary, then
// the unchanged repository preload receives the identical JSON scenario.
// This is characterization of transport, not an implementation correction.
if (!process.env.KF_REVIEW_SCENARIO_FILE) throw new Error('Synthetic scenario file is required');
process.env.KF_SYNTHETIC_GITHUB=fs.readFileSync(process.env.KF_REVIEW_SCENARIO_FILE,'utf8');
await import('./source/scripts/agent-control/tests/helpers/synthetic-github.mjs');
