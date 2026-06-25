import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { assertBusinessAccess } from "../lib/access";

/**
 * Key Connector tRPC Router
 *
 * Provides CRUD operations for the unified integration connector.
 * All procedures are protected and scoped to a business.
 */
export const keyConnectorRouter = router({
  /**
   * List all available integration providers for a business
   */
  getProviders: protectedProcedure
    .input(z.void().optional())
    .query(async ({ ctx }) => {
      const { businessId } = assertBusinessAccess(ctx, ["OWNER", "ADMIN"]);

      const connections = await ctx.db.integrationConnection.findMany({
        where: { businessId },
        select: {
          id: true,
          providerKey: true,
          displayName: true,
          status: true,
          healthScore: true,
          lastSyncAt: true,
          lastError: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { providerKey: "asc" },
      });

      return connections.map((c) => ({
        key: c.providerKey,
        displayName:
          c.displayName ?? c.providerKey.replace(/_/g, " ").toUpperCase(),
        status: c.status.toLowerCase() as
          | "connected"
          | "disconnected"
          | "needs_attention"
          | "error",
        healthScore: c.healthScore,
        lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
        lastError: c.lastError,
        connectedAt: c.createdAt.toISOString(),
      }));
    }),

  /**
   * Get a single provider's connection details
   */
  getProviderDetail: protectedProcedure
    .input(z.object({ providerKey: z.string() }))
    .query(async ({ ctx, input }) => {
      const { businessId } = assertBusinessAccess(ctx, ["OWNER", "ADMIN"]);

      const connection = await ctx.db.integrationConnection.findUnique({
        where: {
          businessId_providerKey: {
            businessId,
            providerKey: input.providerKey,
          },
        },
      });

      if (!connection) return null;

      return {
        id: connection.id,
        key: connection.providerKey,
        displayName: connection.displayName ?? connection.providerKey,
        status: connection.status.toLowerCase() as
          | "connected"
          | "disconnected"
          | "needs_attention"
          | "error",
        healthScore: connection.healthScore,
        settings: connection.settings as Record<string, unknown>,
        lastSyncAt: connection.lastSyncAt?.toISOString() ?? null,
        lastError: connection.lastError,
        createdAt: connection.createdAt.toISOString(),
        updatedAt: connection.updatedAt.toISOString(),
      };
    }),

  /**
   * Connect a provider to the business
   */
  connectProvider: protectedProcedure
    .input(
      z.object({
        providerKey: z.string(),
        displayName: z.string().optional(),
        settings: z.record(z.unknown()).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { businessId, userId } = assertBusinessAccess(ctx, [
        "OWNER",
        "ADMIN",
      ]);

      // Upsert the connection
      const connection = await ctx.db.integrationConnection.upsert({
        where: {
          businessId_providerKey: {
            businessId,
            providerKey: input.providerKey,
          },
        },
        update: {
          status: "CONNECTED",
          displayName: input.displayName,
          settings: input.settings ?? {},
          healthScore: 100,
          lastError: null,
        },
        create: {
          businessId,
          providerKey: input.providerKey,
          displayName: input.displayName ?? input.providerKey,
          status: "CONNECTED",
          healthScore: 100,
          settings: input.settings ?? {},
          scopes: [],
        },
      });

      // Log the audit event
      await ctx.db.connectorAuditLog.create({
        data: {
          businessId,
          userId,
          providerKey: input.providerKey,
          connectionId: connection.id,
          action: "CONNECT_PROVIDER",
          status: "success",
          details: `Connected provider: ${input.providerKey}`,
        },
      });

      return { success: true, connectionId: connection.id };
    }),

  /**
   * Disconnect a provider
   */
  disconnectProvider: protectedProcedure
    .input(z.object({ providerKey: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { businessId, userId } = assertBusinessAccess(ctx, [
        "OWNER",
        "ADMIN",
      ]);

      const connection = await ctx.db.integrationConnection.updateMany({
        where: { businessId, providerKey: input.providerKey },
        data: { status: "DISCONNECTED", healthScore: 0 },
      });

      await ctx.db.connectorAuditLog.create({
        data: {
          businessId,
          userId,
          providerKey: input.providerKey,
          action: "DISCONNECT_PROVIDER",
          status: "success",
          details: `Disconnected provider: ${input.providerKey}`,
        },
      });

      return { success: true, count: connection.count };
    }),

  /**
   * List all connections for a business
   */
  getConnections: protectedProcedure
    .input(z.void().optional())
    .query(async ({ ctx }) => {
      const { businessId } = assertBusinessAccess(ctx, ["OWNER", "ADMIN"]);

      return ctx.db.integrationConnection.findMany({
        where: { businessId },
        orderBy: { updatedAt: "desc" },
      });
    }),

  /**
   * Trigger a sync for a provider
   */
  triggerSync: protectedProcedure
    .input(
      z.object({
        providerKey: z.string(),
        syncType: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { businessId, userId } = assertBusinessAccess(ctx, [
        "OWNER",
        "ADMIN",
      ]);

      const connection = await ctx.db.integrationConnection.update({
        where: {
          businessId_providerKey: {
            businessId,
            providerKey: input.providerKey,
          },
        },
        data: { lastSyncAt: new Date() },
      });

      await ctx.db.connectorAuditLog.create({
        data: {
          businessId,
          userId,
          providerKey: input.providerKey,
          connectionId: connection.id,
          action: "TRIGGER_SYNC",
          status: "success",
          details: `Sync triggered for ${input.providerKey}`,
        },
      });

      return { success: true, connectionId: connection.id };
    }),

  /**
   * Get sync history (audit log entries for sync actions)
   */
  getSyncHistory: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(100).optional(),
          offset: z.number().min(0).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const { businessId } = assertBusinessAccess(ctx, ["OWNER", "ADMIN"]);

      const [items, total] = await Promise.all([
        ctx.db.connectorAuditLog.findMany({
          where: {
            businessId,
            action: { in: ["TRIGGER_SYNC", "SYNC_COMPLETED", "SYNC_FAILED"] },
          },
          orderBy: { createdAt: "desc" },
          take: input?.limit ?? 50,
          skip: input?.offset ?? 0,
        }),
        ctx.db.connectorAuditLog.count({
          where: {
            businessId,
            action: { in: ["TRIGGER_SYNC", "SYNC_COMPLETED", "SYNC_FAILED"] },
          },
        }),
      ]);

      return {
        items,
        total,
        limit: input?.limit ?? 50,
        offset: input?.offset ?? 0,
      };
    }),

  /**
   * Get health status for all connections
   */
  getConnectionHealth: protectedProcedure
    .input(z.void().optional())
    .query(async ({ ctx }) => {
      const { businessId } = assertBusinessAccess(ctx, ["OWNER", "ADMIN"]);

      const connections = await ctx.db.integrationConnection.findMany({
        where: { businessId },
        select: {
          providerKey: true,
          status: true,
          healthScore: true,
          lastSyncAt: true,
          lastError: true,
          updatedAt: true,
        },
      });

      const overallScore = connections.length
        ? Math.round(
            connections.reduce((sum, c) => sum + (c.healthScore ?? 0), 0) /
              connections.length,
          )
        : 100;

      const overallStatus =
        overallScore >= 80
          ? "healthy"
          : overallScore >= 50
            ? "degraded"
            : "critical";

      return {
        overallScore,
        overallStatus,
        providers: connections.map((c) => ({
          providerKey: c.providerKey,
          status: c.status.toLowerCase(),
          healthScore: c.healthScore,
          lastSyncAt: c.lastSyncAt?.toISOString() ?? null,
          lastError: c.lastError,
        })),
      };
    }),

  /**
   * Get full audit log for the business
   */
  getAuditLog: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(100).optional(),
          offset: z.number().min(0).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const { businessId } = assertBusinessAccess(ctx, ["OWNER", "ADMIN"]);

      const [items, total] = await Promise.all([
        ctx.db.connectorAuditLog.findMany({
          where: { businessId },
          orderBy: { createdAt: "desc" },
          take: input?.limit ?? 50,
          skip: input?.offset ?? 0,
        }),
        ctx.db.connectorAuditLog.count({ where: { businessId } }),
      ]);

      return {
        items,
        total,
        limit: input?.limit ?? 50,
        offset: input?.offset ?? 0,
      };
    }),

  /**
   * Process an AI natural-language command for the connector
   */
  processAiCommand: protectedProcedure
    .input(z.object({ command: z.string(), providerKey: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const { businessId, userId } = assertBusinessAccess(ctx, [
        "OWNER",
        "ADMIN",
      ]);

      // Placeholder: In production this calls the AiGatewayService
      // For now, log the attempt and return a structured response
      await ctx.db.connectorAuditLog.create({
        data: {
          businessId,
          userId,
          providerKey: input.providerKey ?? "ai_gateway",
          action: "AI_COMMAND",
          status: "success",
          details: `AI command processed: "${input.command}"`,
        },
      });

      return {
        success: true,
        action: "parsed",
        command: input.command,
        result: {
          message: "Command acknowledged. Full AI processing will be available in the next phase.",
          suggestedActions: [
            "Connect a provider",
            "Run a sync job",
            "Check connection health",
          ],
        },
      };
    }),
});
