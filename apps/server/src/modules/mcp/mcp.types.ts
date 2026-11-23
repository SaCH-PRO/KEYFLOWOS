/** Static, allowlisted remote MCP server configuration.
 *
 * Security posture (deliberate):
 * - Remote HTTP(S) servers only — never stdio/npx processes on the API host.
 * - Static allowlist via MCP_REMOTE_SERVERS env (JSON). No runtime registry
 *   discovery, no version drift: you pin exactly what can be connected.
 * - Auth tokens are per-server bearer tokens from env vars (not committed).
 *   One token per server, shared by every business that server is bound to:
 *   per-business credentials are a later slice (RR-MCP-TENANT-BOUND scope).
 * - Tenant-bound (RR-MCP-TENANT-BOUND, D-261/D-262): every server names the
 *   businesses whose data it may serve (`businessIds`). A config without a
 *   non-empty list of non-empty strings is dropped with an error log, so a
 *   server that is set but unbound serves no business (fail closed).
 */
export interface McpServerConfig {
  /** Short key used in tool names: mcp__{key}__{toolName} */
  key: string;
  /** Display name for logs. */
  name: string;
  /** Remote Streamable HTTP endpoint, e.g. https://mcp.example.com/mcp */
  url: string;
  /** Env var holding the bearer token for this server (optional). */
  tokenEnvVar?: string;
  /** Tool-name prefixes treated as read-only (tier 2). Everything else is tier 3. */
  readOnlyPrefixes?: string[];
  /** Per-server enable switch (default true). */
  enabled?: boolean;
  /**
   * The businesses this server may serve (required, non-empty). A bridged call
   * or tool listing for any other business is refused before anything connects.
   */
  businessIds: string[];
}

type ConfigLog = (message: string) => void;

function isHttpUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
}

function validBusinessIds(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every((id) => typeof id === 'string' && id.length > 0);
}

/**
 * Reads MCP_REMOTE_SERVERS. Unset or empty: no servers, nothing logged. A value
 * that is not a JSON array serves nothing, with an error log (`log`). An entry
 * is dropped with an error log when it lacks a string key or url, when its key
 * is empty or contains "__", when its url does not parse or is not http(s),
 * when an earlier kept entry already uses its key, or when it has no valid
 * `businessIds`. An `enabled: false` entry with a usable
 * key is skipped without a log. The log names the server's key only, never its
 * url or token.
 */
export function loadMcpServerConfigs(log: ConfigLog = () => undefined): McpServerConfig[] {
  const raw = process.env.MCP_REMOTE_SERVERS;
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    log('MCP_REMOTE_SERVERS is not valid JSON; no MCP server is configured');
    return [];
  }
  if (!Array.isArray(parsed)) {
    log('MCP_REMOTE_SERVERS is not a JSON array; no MCP server is configured');
    return [];
  }
  const out: McpServerConfig[] = [];
  const keys = new Set<string>();
  parsed.forEach((s: unknown, index) => {
    const c = s as Partial<McpServerConfig> | null;
    const label = c && typeof c.key === 'string' ? JSON.stringify(c.key) : `#${index}`;
    if (!c || typeof c !== 'object' || typeof c.key !== 'string' || typeof c.url !== 'string') {
      log(`MCP_REMOTE_SERVERS entry ${label} dropped: it needs a string key and url`);
      return;
    }
    if (c.key.length === 0 || c.key.includes('__')) {
      log(`MCP server ${label} dropped: a key must be non-empty and may not contain "__"`);
      return;
    }
    if (!isHttpUrl(c.url)) {
      log(`MCP server ${label} dropped: its url must be an http(s) url`);
      return;
    }
    if (c.enabled === false) return;
    if (keys.has(c.key)) {
      log(`MCP server ${label} dropped: another server already uses that key`);
      return;
    }
    if (!validBusinessIds(c.businessIds)) {
      log(`MCP server ${label} dropped: businessIds must be a non-empty array of business ids; it serves no business until it is bound`);
      return;
    }
    keys.add(c.key);
    out.push({ ...(c as McpServerConfig), businessIds: [...c.businessIds] });
  });
  return out;
}

export interface BridgedTool {
  serverKey: string;
  serverName: string;
  name: string; // original MCP tool name
  bridgedName: string; // mcp__{serverKey}__{name}
  description: string;
  inputSchema: Record<string, unknown>;
  riskTier: 2 | 3;
  riskLevel: 'medium' | 'high';
}

export const MCP_TOOL_PREFIX = 'mcp__';

export function isMcpToolName(name: string): boolean {
  return name.startsWith(MCP_TOOL_PREFIX);
}

export function parseMcpToolName(bridged: string): { serverKey: string; toolName: string } | null {
  if (!isMcpToolName(bridged)) return null;
  const rest = bridged.slice(MCP_TOOL_PREFIX.length);
  const idx = rest.indexOf('__');
  if (idx === -1) return null;
  return { serverKey: rest.slice(0, idx), toolName: rest.slice(idx + 2) };
}
