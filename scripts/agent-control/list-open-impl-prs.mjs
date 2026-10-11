#!/usr/bin/env node
/**
 * List every open implementation PR for the hourly sweep. Read-only.
 *
 * stdout, default: one line per PR, `<number> <mode>`, newest first, where
 * mode is `merge` (inside the sweep's unchanged merge window) or `observe`
 * (outside it: to be evaluated without --merge). With --json: the whole plan.
 * A summary line goes to stderr so it shows in the job log without being
 * mistaken for a PR.
 *
 * Exit codes: 0 the listing is complete, 2 it is not. On 2 stdout is EMPTY:
 * a caller can never loop over half a listing.
 */

import { discoverSweep, sweepLines, LIST_QUERY } from './lib/pr-discovery.mjs';

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const apiBase = process.env.KF_GITHUB_API_URL || 'https://api.github.com';

function fail(message) {
  process.stderr.write(`open pull request discovery failed: ${message}\n`);
  process.exit(2);
}

if (!token || !repo) fail('GITHUB_TOKEN and GITHUB_REPOSITORY are required');
// The override exists for the proofs, which stand a local server in for the
// API. The token is never sent to any other host.
if (apiBase !== 'https://api.github.com' && !/^http:\/\/127\.0\.0\.1:\d+$/.test(apiBase)) {
  fail('KF_GITHUB_API_URL may only point at a loopback test server');
}

async function listPage(page) {
  const path = `/repos/${repo}/pulls?${LIST_QUERY}&page=${page}`;
  const res = await fetch(apiBase + path, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} ${path} ${await res.text()}`);
  return res.json();
}

discoverSweep(listPage, repo)
  .then((plan) => {
    const forks = plan.excluded_forks.length ? `; ${plan.excluded_forks.length} fork PR(s) on impl/ branches left out: ${plan.excluded_forks.map((f) => '#' + f.number).join(', ')}` : '';
    process.stderr.write(
      `discovered ${plan.open_total} open pull request(s) over ${plan.pages} page(s): ${plan.impl.length} implementation, ` +
      `${plan.in_merge_window} inside the ${plan.merge_window}-PR merge window, ${plan.observed_only} observed without merge${forks}\n`,
    );
    // Written only now, in one piece, after the listing is known complete.
    const out = process.argv.includes('--json') ? JSON.stringify(plan) : sweepLines(plan).join('\n');
    process.stdout.write(out ? out + '\n' : '');
    process.exit(0);
  })
  .catch((error) => fail(error.message));
