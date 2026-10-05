#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { fileURLToPath } from 'node:url';

const ENVELOPE_KEYS = new Set([
  'message_id','message_type','packet_id','sender','in_reply_to','source_main',
  'source_head','implementation_branch','pr_number','state','health','control_effect'
]);

export function parseEnvelope(body = '') {
  const out = {};
  for (const line of body.split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (!match) continue;
    const [, key, raw] = match;
    if (!ENVELOPE_KEYS.has(key)) continue;
    if (Object.hasOwn(out, key)) return { malformed: true, reason: 'duplicate_key', key };
    out[key] = raw.trim();
  }
  return { malformed: false, envelope: out };
}

export function mineMotifs(comments, { minCount = 2, maxLength = 5 } = {}) {
  const normalized = [];
  for (const comment of comments) {
    const parsed = parseEnvelope(comment.body || '');
    if (parsed.malformed) {
      normalized.push({
        commentId: comment.id,
        malformed: true,
        reason: parsed.reason,
        duplicateKey: parsed.key,
      });
      continue;
    }
    const e = parsed.envelope;
    if (!e.message_type) continue;
    normalized.push({
      commentId: comment.id,
      createdAt: comment.created_at,
      messageId: e.message_id || null,
      messageType: e.message_type,
      packetId: e.packet_id || 'UNSCOPED',
      sender: e.sender || null,
      controlEffect: e.control_effect || null,
      malformed: false,
    });
  }

  const byPacket = new Map();
  for (const event of normalized.filter((x) => !x.malformed)) {
    if (!byPacket.has(event.packetId)) byPacket.set(event.packetId, []);
    byPacket.get(event.packetId).push(event);
  }
  for (const events of byPacket.values()) {
    events.sort((a, b) =>
      String(a.createdAt || '').localeCompare(String(b.createdAt || '')) ||
      Number(a.commentId || 0) - Number(b.commentId || 0)
    );
  }

  const motifs = new Map();
  for (const [packetId, events] of byPacket) {
    const types = events.map((e) => e.messageType);
    for (let n = 2; n <= Math.min(maxLength, types.length); n++) {
      for (let i = 0; i <= types.length - n; i++) {
        const sequence = types.slice(i, i + n);
        const key = sequence.join(' -> ');
        if (!motifs.has(key)) motifs.set(key, { sequence, count: 0, packetIds: new Set(), examples: [] });
        const motif = motifs.get(key);
        motif.count += 1;
        motif.packetIds.add(packetId);
        if (motif.examples.length < 5) {
          motif.examples.push(events.slice(i, i + n).map((e) => e.commentId));
        }
      }
    }
  }

  const candidates = [...motifs.values()]
    .filter((m) => m.count >= minCount)
    .map((m) => ({
      sequence: m.sequence,
      count: m.count,
      packetIds: [...m.packetIds].sort(),
      examples: m.examples,
      status: 'CANDIDATE_PATTERN',
      authority: 'NONE',
    }))
    .sort((a, b) => b.count - a.count || b.sequence.length - a.sequence.length || a.sequence.join('|').localeCompare(b.sequence.join('|')));

  return {
    schema: 'key-native-capacity/procedure-motif-miner-v0',
    generatedAt: new Date().toISOString(),
    disclaimer:
      'Repeated motifs are candidates only. Frequency does not imply correctness, truth, authority, or eligibility for autonomous execution.',
    normalizedEvents: normalized,
    candidates,
  };
}

function requestJson(url, token) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: token ? `Bearer ${token}` : undefined,
        'User-Agent': 'keyflow-native-capacity-shadow',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GitHub API ${res.statusCode}: ${data.slice(0, 500)}`));
          return;
        }
        resolve(JSON.parse(data));
      });
    });
    req.on('error', reject);
  });
}

async function fetchAllComments(repo, issue, token) {
  const all = [];
  for (let page = 1; page <= 20; page++) {
    const url = `https://api.github.com/repos/${repo}/issues/${issue}/comments?per_page=100&page=${page}`;
    const rows = await requestJson(url, token);
    all.push(...rows);
    if (rows.length < 100) break;
  }
  return all;
}

async function main() {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const issue = Number(process.env.KEYFLOW_CONTROL_ISSUE || '80');
  if (!repo) throw new Error('GITHUB_REPOSITORY is required');
  const comments = await fetchAllComments(repo, issue, token);
  const result = mineMotifs(comments);
  const outPath = process.argv[2] || 'artifacts/key-native-capacity/procedure-motifs.json';
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2) + '\n');
  process.stdout.write(JSON.stringify({ outPath, comments: comments.length, candidates: result.candidates.length }) + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
