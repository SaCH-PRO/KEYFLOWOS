/**
 * The PR the branch's own control artifacts are checked against in the suite
 * (CORRECTION-010 C10-F2).
 *
 * On an impl/* pull_request run, GitHub names the PR: GITHUB_HEAD_REF is its
 * head_ref and GITHUB_REF is refs/pull/<n>/merge. The artifacts must be that
 * PR's. Anywhere else (a local run, main, or a PR the packet controls do not
 * apply to) there is no PR to bind to, so the referent is the branch the
 * active packet declares, and the check is that the two artifacts agree on
 * packet, branch and PR.
 */
export function branchPr(active, env = process.env) {
  const headRef = String(env.GITHUB_HEAD_REF || '');
  if (headRef.startsWith('impl/')) {
    const number = String(env.GITHUB_REF || '').match(/^refs\/pull\/(\d+)\//);
    return { head_ref: headRef, number: number ? Number(number[1]) : active?.pr_number ?? null, source: 'pull_request' };
  }
  return { head_ref: active?.implementation_branch ?? null, number: active?.pr_number ?? null, source: 'artifact' };
}

export default { branchPr };
