'use strict';
/**
 * Preloaded into the spawned server by release0-journey.integration.test.ts
 * through NODE_OPTIONS=--require. It is a harness shim, not product code.
 *
 * main.ts binds the dual-stack wildcard: `app.listen(port, '::')`. On a host
 * whose kernel has no IPv6 at all (several CI sandboxes and containers), that
 * call dies with `listen EAFNOSUPPORT: address family not supported :::<port>`
 * AFTER "Nest application successfully started", so the real server boots
 * completely and then never serves a request. The boot gate in
 * app-module-boots.integration.test.ts does not notice because it stops at the
 * "successfully started" line; a journey has to actually talk to the port.
 *
 * Scope: when, and only when, the host reports no IPv6 interface, the '::'
 * wildcard passed to net.Server#listen is rewritten to '0.0.0.0'. Any other
 * host argument, and every host with IPv6, is left exactly as main.ts asked.
 */
const net = require('net');
const os = require('os');

const hasIpv6 = Object.values(os.networkInterfaces())
  .flat()
  .some((iface) => iface && (iface.family === 'IPv6' || iface.family === 6));

if (!hasIpv6) {
  const originalListen = net.Server.prototype.listen;
  net.Server.prototype.listen = function listenIpv4Fallback(...args) {
    if (typeof args[0] === 'number' && args[1] === '::') {
      args[1] = '0.0.0.0';
      process.stderr.write(
        '[release0-listen-ipv4] host has no IPv6 interface; binding 0.0.0.0 instead of :: (harness shim)\n',
      );
    }
    return originalListen.apply(this, args);
  };
}
