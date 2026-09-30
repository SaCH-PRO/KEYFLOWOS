import fs from 'node:fs';

export function evaluateProbeResult(probe, response, body, forbiddenPatterns = []) {
  const problems = [];
  const expected = Array.isArray(probe.expected_status) ? probe.expected_status : [];
  if (!expected.includes(response.status)) {
    problems.push(`status ${response.status} not in expected [${expected.join(', ')}]`);
  }
  if (probe.protected === true && response.status === 404) {
    problems.push('protected route returned 404; route absence is not auth-boundary proof');
  }
  if (response.status >= 500) {
    problems.push(`server error ${response.status}`);
  }
  for (const needle of probe.body_must_include || []) {
    if (!body.includes(needle)) problems.push(`body missing required fragment: ${needle}`);
  }
  for (const pattern of forbiddenPatterns) {
    if (body.includes(pattern)) problems.push(`response leaked forbidden internal marker: ${pattern}`);
  }
  return problems;
}

async function run() {
  const manifestPath = process.argv[2] || 'scripts/security/native-dast-manifest.json';
  const config = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const base = String(process.env[config.base_url_env || 'NATIVE_DAST_BASE_URL'] || 'http://127.0.0.1:3001').replace(/\/$/, '');
  const results = [];
  let failed = 0;

  for (const probe of config.probes || []) {
    const url = base + probe.path;
    let status = null;
    let body = '';
    let transportError = null;
    try {
      const response = await fetch(url, {
        method: probe.method || 'GET',
        headers: probe.headers || {},
        redirect: 'manual',
      });
      status = response.status;
      body = await response.text();
      const problems = evaluateProbeResult(
        probe,
        { status },
        body,
        config.forbidden_body_patterns || [],
      );
      if (problems.length) failed += 1;
      results.push({
        id: probe.id,
        method: probe.method || 'GET',
        path: probe.path,
        status,
        passed: problems.length === 0,
        problems,
      });
    } catch (error) {
      failed += 1;
      transportError = error instanceof Error ? error.message : String(error);
      results.push({
        id: probe.id,
        method: probe.method || 'GET',
        path: probe.path,
        status,
        passed: false,
        problems: [`transport failure: ${transportError}`],
      });
    }
  }

  const summary = {
    schema_version: 1,
    base_url: base,
    probes: results.length,
    passed: results.length - failed,
    failed,
    results,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  if (failed > 0) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await run();
}
