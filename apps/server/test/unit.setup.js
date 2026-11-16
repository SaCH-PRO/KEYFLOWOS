/**
 * Setup for vitest.unit.config.ts (FU-UNIT-MOCK-ISOLATION): runs before every
 * unit spec file.
 *
 * Installs the unit network guard (helpers/unit-network-guard.js): a request
 * to a host that is not loopback is refused before anything is resolved or
 * sent, so a provider SDK whose vi.mock did not bind fails its test instead of
 * calling the provider. Installing it also takes the proxy variables
 * (HTTPS_PROXY and the like) out of this worker's environment: a unit spec
 * never needs a proxy, and a loopback proxy can relay out. The checks below
 * fail the test (or, for a request made in a file's last hook, the file) that
 * was refused, even when the code under test swallowed the error. They run
 * after the spec's own hooks.
 *
 * JavaScript for the same reason as the helper: TS6059 under rootDir ./src.
 */
import { afterAll, afterEach } from 'vitest';
import { assertNoUnitNetworkViolations, installUnitNetworkGuard } from './helpers/unit-network-guard.js';

installUnitNetworkGuard('vitest.unit.config.ts');

afterEach(() => assertNoUnitNetworkViolations());
afterAll(() => assertNoUnitNetworkViolations());
