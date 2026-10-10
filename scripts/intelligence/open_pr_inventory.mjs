#!/usr/bin/env node
// Read-only GitHub PR inventory. Never treats a PR as implemented or deployed.
// Uses gh api pagination instead of gh pr list's default 30-result limit.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SHA = /^[0-9a-f]{40}$/i;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function requireSha(value, label) {
  if (typeof value !== 'string' || !SHA.test(value)) {
    throw new Error(label + ': invalid SHA; inventory refused');
  }
  return value.toLowerCase();
}

export function buildInventory({ pages, repository, mainSha, observedAt }) {
  if (!REPO.test(repository)) throw new Error('Invalid repository');
  requireSha(mainSha, 'main');
  if (typeof observedAt !== 'string' || !Number.isFinite(Date.parse(observedAt))) {
    throw new Error('Invalid observation timestamp');
  }
  if (!Array.isArray(pages) || pages.length === 0 || !pages.every(Array.isArray)) {
    throw new Error('Expected paginated arrays from gh api --paginate --slurp');
  }
  const seen = new Set();
  const items = [];
  for (const page of pages) {
    if (page.length > 100) throw new Error('Unexpected GitHub page length');
    for (const pr of page) {
      if (!pr || pr.state !== 'open' || !Number.isSafeInteger(pr.number) || pr.number < 1) {
        throw new Error('Invalid or non-open PR in inventory');
      }
      if (seen.has(pr.number)) throw new Error('Duplicate PR #' + pr.number);
      seen.add(pr.number);
      if (typeof pr.title !== 'string' || !pr.title.trim()) throw new Error('Missing PR title');
      if (!pr.base || !pr.head || typeof pr.base.ref !== 'string' ||
          typeof pr.head.ref !== 'string' || !pr.base.ref || !pr.head.ref) {
        throw new Error('Missing PR branch identity #' + pr.number);
      }
      const expectedUrl = 'https://github.com/' + repository + '/pull/' + pr.number;
      if (pr.html_url !== expectedUrl) throw new Error('PR URL mismatch #' + pr.number);
      items.push({
        number: pr.number,
        url: pr.html_url,
        title: pr.title,
        draft: pr.draft === true,
        updated_at: typeof pr.updated_at === 'string' ? pr.updated_at : null,
        base_ref: pr.base.ref,
        base_sha: requireSha(pr.base.sha, 'base #' + pr.number),
        head_ref: pr.head.ref,
        head_sha: requireSha(pr.head.sha, 'head #' + pr.number),
        reconciliation: 'NOT_ASSESSED',
        implementation_proof: 'NOT_ASSESSED',
        deployment_proof: 'NOT_ASSESSED'
      });
    }
  }
  items.sort((a, b) => b.number - a.number);
  const byBase = {};
  for (const item of items) byBase[item.base_ref] = (byBase[item.base_ref] || 0) + 1;
  return {
    schema_version: 1,
    kind: 'PR_OBSERVATION_NOT_AUTHORITY',
    repository,
    observed_at: observedAt,
    observed_main_sha: mainSha.toLowerCase(),
    source: 'GitHub REST GET /repos/{owner}/{repo}/pulls?state=open&per_page=100 (all paginated pages)',
    caveats: [
      'This is a time-bound inventory, not a PR disposition or admission decision.',
      'PR open/draft metadata cannot prove code correctness, merge readiness, product impact or deployed behavior.',
      'No historical chat coverage or research-to-runtime completeness is inferred.'
    ],
    totals: { open: items.length, draft: items.filter(x => x.draft).length,
      not_draft: items.filter(x => !x.draft).length, by_base: byBase },
    pull_requests: items
  };
}

function ghJson(args) {
  const raw = execFileSync('gh', ['api', ...args], {
    encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return JSON.parse(raw);
}

export function cli(args) {
  let repository = 'SaCH-PRO/KEYFLOWOS';
  let outfile = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--repo' && args[i + 1]) repository = args[++i];
    else if (args[i] === '--out' && args[i + 1]) outfile = args[++i];
    else throw new Error('Usage: node open_pr_inventory.mjs [--repo owner/repo] [--out path]');
  }
  if (!REPO.test(repository)) throw new Error('Invalid repository');
  const main = ghJson(['repos/' + repository + '/commits/main']);
  const pages = ghJson(['--paginate', '--slurp',
    'repos/' + repository + '/pulls?state=open&per_page=100']);
  const report = buildInventory({
    pages, repository, mainSha: main.sha, observedAt: new Date().toISOString()
  });
  const output = JSON.stringify(report, null, 2) + '\n';
  if (outfile) writeFileSync(resolve(outfile), output, { flag: 'w' });
  else process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { cli(process.argv.slice(2)); }
  catch (error) {
    console.error('PR_INVENTORY_FAILED: ' + (error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  }
}
