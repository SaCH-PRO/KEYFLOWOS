import { ForbiddenException, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig, BridgedTool } from './mcp.types';
import { loadMcpServerConfigs, parseMcpToolName } from './mcp.types';

const TOOL_CACHE_TTL_MS = 5 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 60_000;

/** One answer for an unknown server, an unbound one and one bound to other businesses. */
const NOT_AVAILABLE = 'MCP server not available to this business';

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '<invalid url>';
  }
}

/**
 * An error message fit for the log. A url may carry credentials (user:pw@,
 * ?token=) and errors quote it, so, in order:
 * 1. the server's url, as configured or in the normalized form fetch quotes,
 *    and whatever url text follows it, becomes `<url host>`;
 * 2. any other url becomes `<url host>` (its user, path and query go);
 * 3. the url's user, password and query values of 3 or more characters, raw,
 *    decoded, percent- and form-encoded, are removed wherever they still
 *    appear, in any letter case, in one pass. Shorter values are left: they
 *    would erase ordinary words.
 * Every step is linear in the message, and the result is capped at
 * LOG_SAFE_MAX characters, so a huge error body cannot stall the event loop.
 * A thrown value that cannot be printed is logged as `<unprintable error>`.
 */
const LOG_SAFE_MAX = 1000;

function logSafe(err: unknown, configUrl: string): string {
  let message: string;
  try {
    message = String((err as Error)?.message ?? err);
  } catch {
    return '<unprintable error>';
  }
  const host = safeHost(configUrl);
  const wholes = [configUrl];
  const fragments: string[] = [];
  try {
    const u = new URL(configUrl);
    wholes.push(u.href);
    fragments.push(u.username, u.password, u.search.slice(1));
    for (const pair of u.search.slice(1).split('&')) fragments.push(pair.slice(pair.indexOf('=') + 1));
    for (const part of [u.username, u.password]) {
      try {
        fragments.push(decodeURIComponent(part));
      } catch {
        // not decodable: the encoded form is already listed
      }
    }
    for (const value of u.searchParams.values()) {
      fragments.push(value, encodeURIComponent(value), new URLSearchParams({ v: value }).toString().slice(2));
    }
  } catch {
    // an unparsable url never connects; its raw form is already listed
  }
  const MARK = '\u0000mcp-url\u0000';
  for (const whole of wholes.filter(Boolean).sort((a, b) => b.length - a.length)) {
    message = message.split(whole).join(MARK);
  }
  message = message.split(MARK).map((piece, index) => (index === 0 ? piece : piece.replace(/^[^\s'"<>]*/, ''))).join(`<url ${host}>`);
  // The lookbehind makes a scheme start only where a letter run starts, so a long run of letters is
  // scanned once, not once per position.
  message = message.replace(/(?<![a-z0-9+.-])[a-z][a-z0-9+.-]*:\/\/[^\s'"<>]+/gi, (url) => `<url ${safeHost(url)}>`);
  const escaped = [...new Set(fragments)]
    .filter((f) => f.length >= 3)
    .sort((a, b) => b.length - a.length)
    .map((f) => f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (escaped.length) message = message.replace(new RegExp(escaped.join('|'), 'gi'), '[redacted]');
  return message.length > LOG_SAFE_MAX ? `${message.slice(0, LOG_SAFE_MAX)}…(truncated)` : message;
}

interface ServerEntry {
  config: McpServerConfig;
  client: Client | null;
  tools: BridgedTool[];
  toolsLoadedAt: number;
  connecting: Promise<Client | null> | null;
}

/**
 * Owns connections to allowlisted remote MCP servers and exposes their tools
 * to the flow tool registry. Connections are lazy (first use) and cached once
 * per server, with that server's one bearer token (shared by every business
 * the server is bound to; per-business credentials are a later slice).
 *
 * Tenancy (RR-MCP-TENANT-BOUND, D-261/D-262): each server config names the
 * businesses it may serve (`businessIds`). listBridgedTools(businessId) lists
 * only servers bound to that business, and callTool(businessId, ...) refuses
 * any other business with a ForbiddenException before anything connects. An
 * unknown server, an unbound one (dropped at load) and one bound to other
 * businesses all get the same refusal. With MCP_REMOTE_SERVERS empty nothing
 * here runs.
 */
@Injectable()
export class McpClientManagerService implements OnModuleDestroy {
  private readonly logger = new Logger(McpClientManagerService.name);
  private readonly servers = new Map<string, ServerEntry>();
  private readonly configs: McpServerConfig[];

  constructor() {
    this.configs = loadMcpServerConfigs((message) => this.logger.error(message));
    if (this.configs.length > 0) {
      this.logger.log(`MCP client manager: ${this.configs.length} allowlisted server(s) configured`);
    }
  }

  async onModuleDestroy() {
    for (const entry of this.servers.values()) {
      if (entry.client) {
        await entry.client.close().catch(() => undefined);
      }
    }
  }

  isConfigured(): boolean {
    return this.configs.length > 0;
  }

  /** List bridged tools of the enabled servers bound to this business. */
  async listBridgedTools(businessId: string): Promise<BridgedTool[]> {
    const out: BridgedTool[] = [];
    for (const config of this.configs) {
      if (!config.businessIds.includes(businessId)) continue;
      const entry = await this.ensureEntry(config);
      if (entry) out.push(...entry.tools);
    }
    return out;
  }

  /**
   * Execute a bridged MCP tool by its mcp__server__tool name for a business.
   * Refused (ForbiddenException) unless that server names the business.
   */
  async callTool(businessId: string, bridgedName: string, args: Record<string, unknown>): Promise<unknown> {
    const parsed = parseMcpToolName(bridgedName);
    if (!parsed) throw new Error(`Not an MCP tool: ${bridgedName}`);
    const config = this.configs.find((c) => c.key === parsed.serverKey);
    if (!config || !config.businessIds.includes(businessId)) throw new ForbiddenException(NOT_AVAILABLE);

    const entry = await this.ensureEntry(config);
    if (!entry?.client) throw new Error(`MCP server ${config.name} is unavailable`);

    let result: unknown;
    try {
      result = await Promise.race([
        entry.client.callTool({ name: parsed.toolName, arguments: args }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`MCP tool call timed out after ${CALL_TIMEOUT_MS}ms`)), CALL_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      // The error goes to the caller and the execution log: the same redaction as the warnings.
      // No `cause`: the caught error is the unredacted one this replaces.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(logSafe(err, config.url));
    }

    // Tool output is untrusted content: cap it before it reaches prompts.
    const text = JSON.stringify(result ?? null);
    return text.length > 8000 ? text.slice(0, 8000) + '…(truncated)' : result;
  }

  private async ensureEntry(config: McpServerConfig): Promise<ServerEntry | null> {
    let entry = this.servers.get(config.key);
    if (!entry) {
      entry = { config, client: null, tools: [], toolsLoadedAt: 0, connecting: null };
      this.servers.set(config.key, entry);
    }

    if (entry.client && Date.now() - entry.toolsLoadedAt < TOOL_CACHE_TTL_MS) {
      return entry;
    }

    if (!entry.connecting) {
      entry.connecting = this.connect(config);
    }

    const client = await entry.connecting.finally(() => {
      entry.connecting = null;
    });

    if (!client) return entry.client ? entry : null;

    entry.client = client;
    try {
      const listed = await client.listTools();
      entry.tools = (listed.tools ?? []).map((t) => this.bridgeTool(config, t));
      entry.toolsLoadedAt = Date.now();
      this.logger.log(`MCP server ${config.name}: ${entry.tools.length} tool(s) bridged`);
    } catch (err) {
      this.logger.warn(`MCP listTools failed for server ${JSON.stringify(config.key)}: ${logSafe(err, config.url)}`);
    }
    return entry;
  }

  private async connect(config: McpServerConfig): Promise<Client | null> {
    try {
      const headers: Record<string, string> = {};
      if (config.tokenEnvVar && process.env[config.tokenEnvVar]) {
        headers.Authorization = `Bearer ${process.env[config.tokenEnvVar]}`;
      }
      const transport = new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: { headers },
      });
      const client = new Client({ name: 'keyflowos', version: '1.0.0' });
      await Promise.race([
        client.connect(transport),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('connect timeout')), CONNECT_TIMEOUT_MS),
        ),
      ]);
      return client;
    } catch (err) {
      // Key and host only: a url may carry credentials (user:pw@, ?token=), and the error quotes it.
      this.logger.warn(`MCP connect failed for server ${JSON.stringify(config.key)} (${safeHost(config.url)}): ${logSafe(err, config.url)}`);
      return null;
    }
  }

  private bridgeTool(config: McpServerConfig, tool: { name: string; description?: string; inputSchema?: Record<string, unknown> }): BridgedTool {
    const readOnly = (config.readOnlyPrefixes ?? ['get', 'list', 'search', 'read', 'fetch', 'query']).some((p) =>
      tool.name.toLowerCase().startsWith(p),
    );
    return {
      serverKey: config.key,
      serverName: config.name,
      name: tool.name,
      bridgedName: `mcp__${config.key}__${tool.name}`,
      description: tool.description ?? `MCP tool ${tool.name} from ${config.name}`,
      inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: 'object', properties: {} },
      riskTier: readOnly ? 2 : 3,
      riskLevel: readOnly ? 'medium' : 'high',
    };
  }
}
