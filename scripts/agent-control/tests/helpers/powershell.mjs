/**
 * Shared PowerShell discovery for the control-plane proofs.
 *
 * Locally a missing PowerShell skips the PowerShell-backed proofs. In CI the
 * workflow sets KF_REQUIRE_POWERSHELL=1, and then a missing PowerShell is a
 * failure: a proof suite that silently skips its PowerShell half would report
 * green without having run the worker's authority or verdict logic at all.
 */

import { spawnSync } from 'node:child_process';

function find() {
  for (const bin of ['pwsh', 'powershell']) {
    const probe = spawnSync(bin, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
    if (probe.status === 0) return bin;
  }
  return null;
}

export const PS = find();

if (!PS && process.env.KF_REQUIRE_POWERSHELL === '1') {
  throw new Error('KF_REQUIRE_POWERSHELL=1 but neither pwsh nor powershell is available');
}

/** node:test `skip` option for a PowerShell-backed proof. */
export const needsPowerShell = PS ? false : 'no PowerShell available';

/**
 * Windows-only suites call this in every test. It FAILS off Windows rather
 * than skipping, so a runner that cannot execute the Windows proofs can never
 * report them as passed (WORKER-CI-PLATFORM-001).
 */
export function requireWindows(assert) {
  assert.equal(process.platform, 'win32', 'this proof must run on Windows; it is not skipped elsewhere');
  assert.ok(PS, 'Windows PowerShell must be available');
}

export default { PS, needsPowerShell, requireWindows };
