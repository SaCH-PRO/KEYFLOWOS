import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { McpServerConfig, BridgedTool } from './mcp.types';
import { loadMcpServerConfigs, parseMcpToolName } from './mcp.types';

const TOOL_CACHE_TTL_MS = 5 * 60 * 1000;
const CONNECT_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 60_000;

interface ServerEntry {
  config: McpServerConfig;
  client: Client | null;
  tools: BridgedTool[];
  toolsLoadedAt: number;
  connecting: Promise<Client | null> | null;
}

/**
 * Owns connections to allowlisted remote MCP servers and exposes their tools
 * to the flow tool registry. Connections are lazy (first use), cached, and
 * never leak across tenants: every call carries the caller's businessId and
 * tools are cached per businessId+server so tool output never crosses
 * businesses.
 */
@Injectable()
export class McpClientManagerService implements OnModuleDestroy {
  private readonly logger = new Logger(McpClientManagerService.name);
  private readonly servers = new Map<string, ServerEntry>();
  private readonly configs: McpServerConfig[];

  constructor() {
    this.configs = loadMcpServerConfigs();
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

  /** List bridged tools across all enabled servers (cached per business). */
  async listBridgedTools(_businessId: string): Promise<BridgedTool[]> {
    const out: BridgedTool[] = [];
    for (const config of this.configs) {
      const entry = await this.ensureEntry(config);
      if (entry) out.push(...entry.tools);
    }
    return out;
  }

  /** Execute a bridged MCP tool by its mcp__server__tool name. */
  async callTool(bridgedName: string, args: Record<string, unknown>): Promise<unknown> {
    const parsed = parseMcpToolName(bridgedName);
    if (!parsed) throw new Error(`Not an MCP tool: ${bridgedName}`);
    const config = this.configs.find((c) => c.key === parsed.serverKey);
    if (!config) throw new Error(`MCP server not allowlisted: ${parsed.serverKey}`);

    const entry = await this.ensureEntry(config);
    if (!entry?.client) throw new Error(`MCP server ${config.name} is unavailable`);

    const result = await Promise.race([
      entry.client.callTool({ name: parsed.toolName, arguments: args }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`MCP tool call timed out after ${CALL_TIMEOUT_MS}ms`)), CALL_TIMEOUT_MS),
      ),
    ]);

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
      this.logger.warn(`MCP listTools failed for ${config.name}: ${(err as Error).message}`);
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
      this.logger.warn(`MCP connect failed for ${config.name} (${config.url}): ${(err as Error).message}`);
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
