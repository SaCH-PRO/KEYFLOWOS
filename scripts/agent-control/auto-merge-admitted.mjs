import fs from 'node:fs';

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const prNumber = Number(process.env.PR_NUMBER || 0);
if (!token || !repo || !prNumber) throw new Error('GITHUB_TOKEN, GITHUB_REPOSITORY and PR_NUMBER are required');

const api = async (path, init = {}) => {
  const res = await fetch('https://api.github.com' + path, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: 'Bearer ' + token,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(init.headers || {}),
    },
  });
  if (!res.ok) throw new Error(res.status + ' ' + res.statusText + ' ' + await res.text());
  return res.status === 204 ? null : res.json();
};

const decode = (x) => Buffer.from(x, 'base64').toString('utf8');
const field = (text, key) => {
  const m = text.match(new RegExp('^' + key + ':\\s*([^\\n]+)$', 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};

const pr = await api('/repos/' + repo + '/pulls/' + prNumber);
const result = { eligible: false, reason: null, pr: prNumber, head_sha: pr.head.sha };

if (pr.state !== 'open') result.reason = 'pr_not_open';
else if (pr.draft) result.reason = 'pr_is_draft';
else if (!pr.head.ref.startsWith('impl/')) result.reason = 'not_impl_branch';
else {
  const [activeRaw, returnRaw] = await Promise.all([
    api('/repos/' + repo + '/contents/.agent-control/active-packet.yaml?ref=' + pr.head.sha),
    api('/repos/' + repo + '/contents/.agent-control/claude-return.yaml?ref=' + pr.head.sha),
  ]);
  const active = decode(activeRaw.content);
  const ret = decode(returnRaw.content);

  if (field(ret, 'review_status') !== 'READY_TO_MERGE') result.reason = 'review_not_ready';
  else if (field(active, 'production_touched') === 'true' || field(ret, 'production_touched') === 'true') result.reason = 'production_touched';
  else if (field(active, 'source_main') !== pr.base.sha || field(ret, 'source_main') !== pr.base.sha) result.reason = 'source_main_drift';
  else {
    const runs = await api('/repos/' + repo + '/actions/runs?head_sha=' + pr.head.sha + '&event=pull_request&per_page=100');
    const required = ['CI/CD Pipeline', 'Agent Control Gate', 'Branch divergence', 'DAST (HawkScan)'];
    const latest = new Map();
    for (const run of runs.workflow_runs || []) {
      if (!required.includes(run.name)) continue;
      const prev = latest.get(run.name);
      if (!prev || new Date(run.created_at) > new Date(prev.created_at)) latest.set(run.name, run);
    }
    const missing = required.filter((name) => !latest.has(name));
    const notGreen = required.filter((name) => latest.has(name) && !(latest.get(name).status === 'completed' && latest.get(name).conclusion === 'success'));
    if (missing.length) result.reason = 'missing_workflows:' + missing.join(',');
    else if (notGreen.length) result.reason = 'workflows_not_green:' + notGreen.join(',');
    else {
      result.eligible = true;
      result.reason = 'all_admission_contracts_satisfied';
      if (process.argv.includes('--merge')) {
        const merged = await api('/repos/' + repo + '/pulls/' + prNumber + '/merge', {
          method: 'PUT',
          body: JSON.stringify({
            sha: pr.head.sha,
            merge_method: 'squash',
            commit_title: pr.title,
          }),
          headers: { 'Content-Type': 'application/json' },
        });
        result.merge = merged;
      }
    }
  }
}

process.stdout.write(JSON.stringify(result));
