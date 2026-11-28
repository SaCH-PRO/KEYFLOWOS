import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const MONITOR_SCRIPT = resolve(REPO_ROOT, 'scripts/uptime-monitor.sh');
const SLO_DOC = resolve(REPO_ROOT, 'docs/ops/SLO.md');

/**
 * Create a stub `curl` binary on PATH so uptime-monitor.sh runs completely offline.
 * The stub responds to /api/healthz and /readyz according to env vars STUB_WEB_MODE
 * and STUB_API_MODE ("ok" | "fail"), and logs any POST webhook calls to STUB_WEBHOOK_LOG.
 */
function makeStubBin(dir) {
  const curlPath = join(dir, 'curl');
  const script = `#!/usr/bin/env bash
set -euo pipefail
out_file=""
write_out=""
method="GET"
data=""
url=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out_file="$2"; shift 2 ;;
    -w) write_out="$2"; shift 2 ;;
    -X) method="$2"; shift 2 ;;
    --data) data="$2"; shift 2 ;;
    -H|-m) shift 2 ;;
    -sS|-s|-S) shift ;;
    *) url="$1"; shift ;;
  esac
done

if [ "$method" = "POST" ]; then
  if [ -n "\${STUB_WEBHOOK_LOG:-}" ]; then
    printf '%s\\t%s\\n' "$url" "$data" >> "$STUB_WEBHOOK_LOG"
  fi
  exit 0
fi

if [[ "$url" == *"/api/healthz" ]]; then
  mode="\${STUB_WEB_MODE:-ok}"
  if [ "$mode" = "ok" ]; then
    [ -n "$out_file" ] && printf '{"status":"ok","apiReachable":true}' > "$out_file"
    [ -n "$write_out" ] && printf '200'
  else
    [ -n "$out_file" ] && printf '{"status":"degraded","apiReachable":false}' > "$out_file"
    [ -n "$write_out" ] && printf '503'
  fi
  exit 0
fi

if [[ "$url" == *"/readyz" ]]; then
  mode="\${STUB_API_MODE:-ok}"
  if [ "$mode" = "ok" ]; then
    [ -n "$out_file" ] && printf '{"db":{"ok":true}}' > "$out_file"
    [ -n "$write_out" ] && printf '200'
  else
    [ -n "$out_file" ] && printf '{"db":{"ok":false}}' > "$out_file"
    [ -n "$write_out" ] && printf '503'
  fi
  exit 0
fi

exit 22
`;
  writeFileSync(curlPath, script, 'utf8');
  chmodSync(curlPath, 0o755);
  return dir;
}

function runMonitor(stubBinDir, envExtra = {}) {
  try {
    const stdout = execFileSync('bash', [MONITOR_SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${stubBinDir}:${process.env.PATH}`,
        BASE_URL: 'https://stub.invalid',
        API_BASE: 'https://api.stub.invalid',
        ...envExtra,
      },
    });
    return { status: 0, stdout };
  } catch (err) {
    return {
      status: err.status ?? 1,
      stdout: String(err.stdout ?? ''),
      stderr: String(err.stderr ?? ''),
    };
  }
}

test('RR-SLO-AVAILABILITY-LEDGER: seeded 28 good + 2 failed probes reports 30-day availability and error budget', () => {
  const work = mkdtempSync(join(tmpdir(), 'kf-slo-seeded-'));
  try {
    const stubBin = makeStubBin(work);
    const stateFile = join(work, 'state.json');
    // Seed 28 good and 2 failed probes for api.readyz on 2026-11-27 (within the 30d window).
    writeFileSync(
      stateFile,
      JSON.stringify({
        web_healthz: 0,
        api_readyz: 0,
        slo: {
          web_healthz: { days: { '2026-11-27': { good: 30, total: 30 } }, budget_exhausted: false },
          api_readyz: { days: { '2026-11-27': { good: 28, total: 30 } }, budget_exhausted: false },
        },
        updatedAt: '2026-11-27T23:55:00Z',
      }),
      'utf8',
    );

    const res = runMonitor(stubBin, {
      STATE_FILE: stateFile,
      UPTIME_NOW_UTC: '2026-11-28T00:05:00Z',
      STUB_WEB_MODE: 'ok',
      STUB_API_MODE: 'ok',
    });
    assert.equal(res.status, 0, res.stdout);
    // After 1 new good probe on 2026-11-28: api.readyz has 29 good / 31 total = 93.55%, budget 0.00% (target 99.5%).
    assert.match(res.stdout, /api\.readyz availability_30d=93\.55% error_budget_remaining=0\.00%/);
    assert.match(res.stdout, /web\.healthz availability_30d=100\.00% error_budget_remaining=100\.00%/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('RR-SLO-AVAILABILITY-LEDGER: rolling window drops days older than 30 days and recomputes availability/budget', () => {
  const work = mkdtempSync(join(tmpdir(), 'kf-slo-rollout-'));
  try {
    const stubBin = makeStubBin(work);
    const stateFile = join(work, 'state.json');
    // 2026-10-20 is > 30 days before 2026-11-28 and must roll out; 2026-11-27 stays inside the window.
    // On 2026-11-27: 997 good / 999 total. Plus 1 good probe on 2026-11-28 => 998 / 1000 = 99.80%.
    // With 99.5% SLO (0.5% error budget), observed error = 0.2%, remaining budget = (0.5 - 0.2) / 0.5 = 60.00%.
    writeFileSync(
      stateFile,
      JSON.stringify({
        web_healthz: 0,
        api_readyz: 0,
        slo: {
          web_healthz: {
            days: {
              '2026-10-20': { good: 0, total: 100 },
              '2026-11-27': { good: 199, total: 199 },
            },
            budget_exhausted: false,
          },
          api_readyz: {
            days: {
              '2026-10-20': { good: 0, total: 100 },
              '2026-11-27': { good: 997, total: 999 },
            },
            budget_exhausted: false,
          },
        },
        updatedAt: '2026-11-27T23:55:00Z',
      }),
      'utf8',
    );

    const res = runMonitor(stubBin, {
      STATE_FILE: stateFile,
      UPTIME_NOW_UTC: '2026-11-28T00:05:00Z',
      STUB_WEB_MODE: 'ok',
      STUB_API_MODE: 'ok',
    });
    assert.equal(res.status, 0, res.stdout);
    assert.match(res.stdout, /api\.readyz availability_30d=99\.80% error_budget_remaining=60\.00%/);
    assert.match(res.stdout, /web\.healthz availability_30d=100\.00% error_budget_remaining=100\.00%/);

    const saved = JSON.parse(readFileSync(stateFile, 'utf8'));
    assert.equal(saved.slo.api_readyz.days['2026-10-20'], undefined, 'expired day must be pruned');
    assert.deepEqual(saved.slo.api_readyz.days['2026-11-28'], { good: 1, total: 1 });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('RR-SLO-AVAILABILITY-LEDGER: state file stays bounded after 40 simulated days', () => {
  const work = mkdtempSync(join(tmpdir(), 'kf-slo-40days-'));
  try {
    const stubBin = makeStubBin(work);
    const stateFile = join(work, 'state.json');
    const baseMs = Date.UTC(2026, 9, 1, 12, 0, 0); // 2026-10-01T12:00:00Z
    for (let day = 0; day < 40; day += 1) {
      const iso = new Date(baseMs + day * 86400 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const res = runMonitor(stubBin, {
        STATE_FILE: stateFile,
        UPTIME_NOW_UTC: iso,
        STUB_WEB_MODE: 'ok',
        STUB_API_MODE: 'ok',
      });
      assert.equal(res.status, 0, `day ${day}: ${res.stdout}`);
    }
    const raw = readFileSync(stateFile, 'utf8');
    assert.ok(Buffer.byteLength(raw, 'utf8') < 4096, `state file too large: ${Buffer.byteLength(raw, 'utf8')} bytes`);
    const saved = JSON.parse(raw);
    assert.ok(Object.keys(saved.slo.web_healthz.days).length <= 30, 'web_healthz days bounded to 30');
    assert.ok(Object.keys(saved.slo.api_readyz.days).length <= 30, 'api_readyz days bounded to 30');
    assert.equal(Object.keys(saved.slo.api_readyz.days).length, 30, 'rolling window retains 30 days');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('RR-SLO-AVAILABILITY-LEDGER: exhausted error budget emits exactly one alert per transition', () => {
  const work = mkdtempSync(join(tmpdir(), 'kf-slo-alert-'));
  try {
    const stubBin = makeStubBin(work);
    const stateFile = join(work, 'state.json');
    const webhookLog = join(work, 'webhooks.log');
    // Start healthy: 199 good / 199 total (100% >= 99.5%, budget_exhausted=false).
    writeFileSync(
      stateFile,
      JSON.stringify({
        web_healthz: 0,
        api_readyz: 0,
        slo: {
          web_healthz: { days: { '2026-11-28': { good: 200, total: 200 } }, budget_exhausted: false },
          api_readyz: { days: { '2026-11-28': { good: 198, total: 199 } }, budget_exhausted: false },
        },
        updatedAt: '2026-11-28T00:00:00Z',
      }),
      'utf8',
    );

    // Run 1: api fails (1st consecutive failure -> no DOWN page, but 198/200 = 99.00% < 99.5% -> budget exhausted!).
    const r1 = runMonitor(stubBin, {
      STATE_FILE: stateFile,
      UPTIME_NOW_UTC: '2026-11-28T00:05:00Z',
      ALERT_WEBHOOK_URL: 'https://hooks.stub.invalid/alert',
      STUB_WEBHOOK_LOG: webhookLog,
      STUB_WEB_MODE: 'ok',
      STUB_API_MODE: 'fail',
    });
    assert.equal(r1.status, 0, 'single probe failure stays below FAIL_THRESHOLD=2');
    const lines1 = readFileSync(webhookLog, 'utf8').trim().split('\n').filter(Boolean);
    const sloAlerts1 = lines1.filter((l) => l.includes('SLO_BUDGET_EXHAUSTED'));
    assert.equal(sloAlerts1.length, 1, `expected 1 budget exhaustion alert on transition, got: ${lines1.join('\n')}`);

    // Run 2: api passes (199/201 = 99.00% < 99.5%, STILL exhausted -> must NOT alert again).
    const r2 = runMonitor(stubBin, {
      STATE_FILE: stateFile,
      UPTIME_NOW_UTC: '2026-11-28T00:10:00Z',
      ALERT_WEBHOOK_URL: 'https://hooks.stub.invalid/alert',
      STUB_WEBHOOK_LOG: webhookLog,
      STUB_WEB_MODE: 'ok',
      STUB_API_MODE: 'ok',
    });
    assert.equal(r2.status, 0);
    const lines2 = readFileSync(webhookLog, 'utf8').trim().split('\n').filter(Boolean);
    const sloAlerts2 = lines2.filter((l) => l.includes('SLO_BUDGET_EXHAUSTED'));
    assert.equal(sloAlerts2.length, 1, 'still-exhausted run must not emit a duplicate alert');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

test('RR-SLO-AVAILABILITY-LEDGER: with no state file behaves as today and docs/ops/SLO.md records the objective', () => {
  const work = mkdtempSync(join(tmpdir(), 'kf-slo-fresh-'));
  try {
    const stubBin = makeStubBin(work);
    const stateFile = join(work, 'fresh-state.json');
    const webhookLog = join(work, 'webhooks.log');

    // Single transient failure with no prior state file: exits 0 and emits zero alerts.
    const rFail = runMonitor(stubBin, {
      STATE_FILE: stateFile,
      UPTIME_NOW_UTC: '2026-11-28T00:05:00Z',
      ALERT_WEBHOOK_URL: 'https://hooks.stub.invalid/alert',
      STUB_WEBHOOK_LOG: webhookLog,
      STUB_WEB_MODE: 'ok',
      STUB_API_MODE: 'fail',
    });
    assert.equal(rFail.status, 0);
    assert.equal(existsSync(webhookLog), false, 'single blip on fresh state must not emit alerts');
    assert.match(rFail.stdout, /api\.readyz availability_30d=0\.00% error_budget_remaining=0\.00%/);

    // Written SLO doc names both probed endpoints, 30-day rolling window, and 99.5% proposed objective.
    assert.equal(existsSync(SLO_DOC), true, 'docs/ops/SLO.md must exist');
    const doc = readFileSync(SLO_DOC, 'utf8');
    assert.match(doc, /\/api\/healthz/);
    assert.match(doc, /\/readyz/);
    assert.match(doc, /30-day|30 days/i);
    assert.match(doc, /99\.5%/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
