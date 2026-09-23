#!/usr/bin/env node
/**
 * Normalize a GitHub event into a control event with a stable idempotency key.
 *
 * Adopted from the PR #86 prototype and corrected: identity now derives from
 * the underlying event (comment id, run id + attempt, merge commit) instead of
 * the observing workflow's run id, so retries and replays converge. (F3)
 *
 * Usage: GITHUB_EVENT_NAME=... GITHUB_EVENT_PATH=... node normalize-event.mjs
 */

import fs from 'node:fs';
import { normalizeEvent } from './lib/events.mjs';

const eventName = process.env.GITHUB_EVENT_NAME || '';
const eventPath = process.env.GITHUB_EVENT_PATH;
if (!eventPath) {
  process.stderr.write('GITHUB_EVENT_PATH is required\n');
  process.exit(2);
}

let payload;
try {
  payload = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
} catch (error) {
  process.stderr.write(`could not read event payload: ${error.message}\n`);
  process.exit(2);
}

if (process.env.GITHUB_RUN_ID) payload.__run_id = process.env.GITHUB_RUN_ID;

process.stdout.write(JSON.stringify(normalizeEvent(eventName, payload)));
