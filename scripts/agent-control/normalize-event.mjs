import fs from 'node:fs';

const eventName = process.env.GITHUB_EVENT_NAME || '';
const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath) throw new Error('GITHUB_EVENT_PATH is required');

const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));

function parseControlMessage(body = '') {
  const pick = (key) => {
    const m = body.match(new RegExp('^' + key + ':\\s*([^\\n]+)$', 'm'));
    return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
  };
  return {
    message_id: pick('message_id'),
    message_type: pick('message_type'),
    packet_id: pick('packet_id'),
    state: pick('state'),
    health: pick('health'),
  };
}

function classify() {
  if (eventName === 'issue_comment') {
    if (event.issue?.number !== 80) return { actionable: false, kind: 'IGNORE' };
    const msg = parseControlMessage(event.comment?.body || '');
    const actionableTypes = new Set(['RETURN', 'CONTRADICTION', 'MOMENTUM']);
    return {
      actionable: actionableTypes.has(msg.message_type),
      kind: msg.message_type || 'CONTROL_COMMENT',
      ...msg,
      source: 'issue_comment',
      ref: event.comment?.html_url || null,
    };
  }

  if (eventName === 'pull_request_target') {
    const pr = event.pull_request || {};
    if (!String(pr.head?.ref || '').startsWith('impl/')) return { actionable: false, kind: 'IGNORE' };
    return {
      actionable: event.action === 'closed' && pr.merged === true,
      kind: pr.merged ? 'PR_MERGED' : 'PR_EVENT',
      packet_id: null,
      source: 'pull_request_target',
      pr_number: pr.number,
      head_sha: pr.head?.sha || null,
      ref: pr.html_url || null,
    };
  }

  if (eventName === 'workflow_run') {
    const run = event.workflow_run || {};
    const prs = run.pull_requests || [];
    const pr = prs[0];
    if (!pr) return { actionable: false, kind: 'WORKFLOW_NO_PR' };
    return {
      actionable: run.status === 'completed',
      kind: 'WORKFLOW_COMPLETED',
      source: 'workflow_run',
      workflow: run.name,
      conclusion: run.conclusion,
      head_sha: run.head_sha,
      pr_number: pr.number,
      ref: run.html_url || null,
    };
  }

  if (eventName === 'workflow_dispatch') {
    return { actionable: true, kind: 'MANUAL_RECONCILE', source: 'workflow_dispatch' };
  }

  if (eventName === 'schedule') {
    return { actionable: true, kind: 'SCHEDULED_RECONCILE', source: 'schedule' };
  }

  return { actionable: false, kind: 'IGNORE', source: eventName };
}

const result = classify();
process.stdout.write(JSON.stringify(result));
