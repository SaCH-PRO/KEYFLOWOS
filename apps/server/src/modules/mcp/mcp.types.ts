/** Static, allowlisted remote MCP server configuration.
 *
 * Security posture (deliberate):
 * - Remote HTTP(S) servers only — never stdio/npx processes on the API host.
 * - Static allowlist via MCP_REMOTE_SERVERS env (JSON). No runtime registry
 *   discovery, no version drift: you pin exactly what can be connected.
 * - Auth tokens are per-server bearer tokens from env vars (not committed).
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
}

export function loadMcpServerConfigs(): McpServerConfig[] {
  const raw = process.env.MCP_REMOTE_SERVERS;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as McpServerConfig[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s) => s && typeof s.key === 'string' && typeof s.url === 'string' && s.enabled !== false);
  } catch {
    return [];
  }
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
