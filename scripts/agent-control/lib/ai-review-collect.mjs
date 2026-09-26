/**
 * AI REVIEW EVIDENCE COLLECTION — reads everything lib/ai-review.mjs needs for
 * one PR from GitHub. Shared by the AI Review Gate CLI and by the exact-head
 * merge path (auto-merge-admitted.mjs), which runs it from trusted main so a
 * PR that rewrites its own gate workflow still cannot supply the verdict.
 *
 * Read-only. Anything it cannot read completely is reported as truncated or
 * left unproven, both of which fail closed in the evaluator.
 */

import { requiredComparisons, parseLedgerFindings, LEDGER_MARKER } from './ai-review.mjs';

const AUTHOR = '__typename login ... on Bot { id } ... on User { id }';
const EDITOR = 'editor { __typename login ... on Bot { id } ... on User { id } }';

const QUERY = `
query($owner: String!, $name: String!, $number: Int!, $reviewsAfter: String, $threadsAfter: String) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      state isDraft headRefOid baseRefOid
      reviews(first: 100, after: $reviewsAfter) {
        pageInfo { hasNextPage endCursor }
        nodes { databaseId state submittedAt body commit { oid } author { ${AUTHOR} } ${EDITOR} }
      }
      reviewThreads(first: 100, after: $threadsAfter) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id isResolved isOutdated path line originalLine
          comments(first: 100) {
            pageInfo { hasNextPage }
            nodes { databaseId body createdAt commit { oid } originalCommit { oid } author { ${AUTHOR} } ${EDITOR} }
          }
        }
      }
    }
  }
}`;

const toActor = (a) => (a ? { login: a.login, type: a.__typename, id: a.id ?? null } : null);

/** A GitHub client over fetch: { rest(path), graphql(query, variables) }. */
export function githubClient(token) {
  async function request(url, init = {}) {
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.headers || {}),
      },
    });
    if (!res.ok) {
      const error = new Error(`${res.status} ${res.statusText} ${url} ${await res.text()}`);
      error.status = res.status;
      throw error;
    }
    return res.json();
  }
  return {
    rest: (path) => request('https://api.github.com' + path),
    async graphql(query, variables) {
      const body = await request('https://api.github.com/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      if (body.errors?.length) throw new Error('graphql: ' + JSON.stringify(body.errors));
      return body.data;
    },
  };
}

/**
 * @param {object} args
 *   client: githubClient(); repo: "owner/name"; prNumber
 *   expectedHead: head the triggering event was about (optional)
 *   deletedComment: REST payload of a review comment deletion event (optional)
 */
export async function collectAiReviewSnapshot({ client, repo, prNumber, expectedHead = null, deletedComment = null }) {
  const [owner, name] = repo.split('/');
  let reviewsAfter = null;
  let threadsAfter = null;
  let pr = null;
  const reviews = [];
  const threads = [];
  let truncated = false;

  // Page both connections until exhausted; bounded so a runaway cursor fails closed.
  for (let page = 0; page < 20; page += 1) {
    const data = await client.graphql(QUERY, { owner, name, number: prNumber, reviewsAfter, threadsAfter });
    const p = data.repository.pullRequest;
    pr = pr || p;
    if (page === 0 || reviewsAfter) {
      for (const r of p.reviews.nodes) {
        reviews.push({
          id: r.databaseId,
          author: toActor(r.author),
          editor: toActor(r.editor),
          state: r.state,
          commit_sha: r.commit?.oid ?? null,
          submitted_at: r.submittedAt,
          body: r.body,
        });
      }
    }
    if (page === 0 || threadsAfter) {
      for (const t of p.reviewThreads.nodes) {
        if (t.comments.pageInfo.hasNextPage) truncated = true;
        threads.push({
          id: t.id,
          is_resolved: t.isResolved,
          is_outdated: t.isOutdated,
          path: t.path,
          line: t.line ?? t.originalLine ?? null,
          comments: t.comments.nodes.map((c) => ({
            id: c.databaseId,
            author: toActor(c.author),
            editor: toActor(c.editor),
            body: c.body,
            commit_sha: c.commit?.oid ?? null,
            original_commit_sha: c.originalCommit?.oid ?? null,
            created_at: c.createdAt,
          })),
        });
      }
    }
    // A finished connection stays finished: re-querying it with a null cursor
    // returns its first page again, which must not restart its cursor.
    if (page === 0 || reviewsAfter) reviewsAfter = p.reviews.pageInfo.hasNextPage ? p.reviews.pageInfo.endCursor : null;
    if (page === 0 || threadsAfter) threadsAfter = p.reviewThreads.pageInfo.hasNextPage ? p.reviewThreads.pageInfo.endCursor : null;
    if (!reviewsAfter && !threadsAfter) break;
    if (page === 19) truncated = true;
  }

  // PR conversation: earlier gate ledgers (durable finding history) and PR-level dispositions.
  const conversation = [];
  for (let page = 1; page <= 30; page += 1) {
    const batch = await client.rest(`/repos/${repo}/issues/${prNumber}/comments?per_page=100&page=${page}`);
    conversation.push(...batch);
    if (batch.length < 100) break;
    if (page === 30) truncated = true;
  }
  const recorded = [];
  const prDispositions = [];
  for (const c of conversation) {
    const body = String(c.body || '');
    if (c.user?.login === 'github-actions[bot]' && body.includes(`<!-- ${LEDGER_MARKER} `)) {
      recorded.push(...parseLedgerFindings(body));
    } else {
      prDispositions.push({ id: c.id, author: { login: c.user?.login, type: c.user?.type, id: c.user?.node_id ?? null }, body, created_at: c.created_at });
    }
  }
  // A deletion event carries the deleted comment itself: record it before it is gone for good.
  if (deletedComment && !deletedComment.in_reply_to_id) {
    recorded.push({
      id: `F-${deletedComment.id}`,
      reviewer_author: { login: deletedComment.user?.login, type: deletedComment.user?.type, id: deletedComment.user?.node_id ?? null },
      severity: 'UNCLASSIFIED',
      source: 'deletion_event',
    });
  }

  // Changed files for high-risk classification (GitHub caps this listing at 3000).
  const files = [];
  let filesTruncated = false;
  for (let page = 1; page <= 30; page += 1) {
    const batch = await client.rest(`/repos/${repo}/pulls/${prNumber}/files?per_page=100&page=${page}`);
    files.push(...batch.map((f) => ({ filename: f.filename, patch: f.patch ?? null })));
    if (batch.length < 100) break;
    if (page === 30) filesTruncated = true;
  }

  const snapshot = {
    pr: { number: prNumber, state: String(pr.state).toLowerCase(), draft: pr.isDraft, head_sha: pr.headRefOid, base_sha: pr.baseRefOid },
    expected_head_sha: expectedHead,
    reviews,
    threads,
    recorded_findings: recorded,
    pr_dispositions: prDispositions,
    files,
    files_truncated: filesTruncated,
    evidence_truncated: truncated,
    comparisons: {},
  };

  for (const { from, to } of requiredComparisons(snapshot)) {
    try {
      const cmp = await client.rest(`/repos/${repo}/compare/${from}...${to}`);
      // The compare file list caps at 300; a longer list cannot prove control-only.
      const list = (cmp.files || []).map((f) => f.filename);
      snapshot.comparisons[`${from}...${to}`] = { status: cmp.status, files: list.length >= 300 ? [...list, '<compare file list truncated>'] : list };
    } catch (error) {
      // Unknown commit (force-pushed away, typo): leave it unproven, which fails closed.
      if (error.status !== 404 && error.status !== 422) throw error;
    }
  }
  return snapshot;
}

export default { collectAiReviewSnapshot, githubClient };
