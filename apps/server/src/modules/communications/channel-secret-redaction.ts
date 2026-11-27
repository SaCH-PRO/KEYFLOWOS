/**
 * Shared pure secret-stripping helpers for ChannelConnection and ChannelDestination
 * HTTP responses (FU-NESTED-CREDENTIAL-READS, P149).
 *
 * Internal publishing paths (e.g. DeliveryQueueService, MetaAdapter) read raw
 * Postgres rows directly and still have full access to stored credentials.
 * Every HTTP-facing read/write response passes through these sanitizers so
 * top-level OAuth tokens and nested destinationMeta secrets are never disclosed.
 */

const DESTINATION_SECRET_KEY_RE =
  /(?:token|secret|password|passwd|api_?key|credential|private_?key|auth_?data)/i;

function isEncryptedCiphertextValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim().startsWith('enc:v1:');
}

/**
 * Recursively removes secret keys and `enc:v1:` ciphertext values from a
 * ChannelDestination.destinationMeta payload without mutating the input.
 * Non-secret metadata (pageId, pageName, igUserId, username, phoneNumberId,
 * wabaId, fromEmail, etc.) is preserved verbatim.
 */
export function stripDestinationMetaSecrets(
  meta: unknown,
  seen: WeakSet<object> = new WeakSet<object>(),
): unknown {
  if (meta === null || meta === undefined || typeof meta !== 'object') {
    return isEncryptedCiphertextValue(meta) ? undefined : meta;
  }
  if (meta instanceof Date) {
    return meta;
  }
  if (seen.has(meta)) {
    return undefined;
  }
  seen.add(meta);

  if (Array.isArray(meta)) {
    const out: unknown[] = [];
    for (const item of meta) {
      if (isEncryptedCiphertextValue(item)) continue;
      out.push(stripDestinationMetaSecrets(item, seen));
    }
    return out;
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta as Record<string, unknown>)) {
    if (DESTINATION_SECRET_KEY_RE.test(key)) continue;
    if (isEncryptedCiphertextValue(value)) continue;
    out[key] = stripDestinationMetaSecrets(value, seen);
  }
  return out;
}

/**
 * Returns a shallow copy of a ChannelDestination record with `destinationMeta`
 * recursively stripped of secrets and any nested `connection.token` /
 * `connection.refreshToken` omitted.
 */
export function stripDestinationSecrets<T>(dest: T): T {
  if (!dest || typeof dest !== 'object' || Array.isArray(dest)) {
    return dest;
  }
  const out: Record<string, unknown> = { ...(dest as Record<string, unknown>) };
  if ('destinationMeta' in out) {
    out.destinationMeta = stripDestinationMetaSecrets(out.destinationMeta);
  }
  if (out.connection && typeof out.connection === 'object' && !Array.isArray(out.connection)) {
    const {
      token: _token,
      refreshToken: _refreshToken,
      ...safeConn
    } = out.connection as Record<string, unknown>;
    void _token;
    void _refreshToken;
    out.connection = safeConn;
  }
  return out as T;
}

/**
 * Returns a copy of a ChannelConnection record with top-level `token` and
 * `refreshToken` omitted AND every nested `destinations[]` item sanitized via
 * `stripDestinationSecrets`.
 */
export function stripConnectionSecrets<T extends Record<string, unknown>>(
  conn: T,
): Omit<T, 'token' | 'refreshToken'> {
  const { token: _token, refreshToken: _refreshToken, ...safe } = conn;
  void _token;
  void _refreshToken;
  if (Array.isArray(safe.destinations)) {
    return {
      ...safe,
      destinations: safe.destinations.map((dest) => stripDestinationSecrets(dest)),
    } as Omit<T, 'token' | 'refreshToken'>;
  }
  return safe as Omit<T, 'token' | 'refreshToken'>;
}
