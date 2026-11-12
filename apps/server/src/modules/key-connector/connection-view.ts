import type { KeyConnectorConnection } from './key-connector.types';

/** A connection as KeyFlow answers it: everything but its stored credentials. */
export type ConnectionView = Omit<KeyConnectorConnection, 'authData'>;

/**
 * W7-KEY-CONNECTOR-TENANT review SEC-W7KC-1 (the R0-SEC2 class):
 * KeyConnectorService maps each IntegrationConnection row with its stored
 * provider credentials (`authData`, which its sync and health engines read).
 * A connection leaves the service through this projection only, an allow-list,
 * so a column added later is not answered by default either. The tRPC router
 * never selects authData.
 *
 * Two doors answer connections through it: KeyConnectorController (every
 * route), and, since W11-KEY-ORGAN-OUTPUT-REDACT, the KEY organ tools
 * key_connector.list_connections and key_connector.list_providers, whose
 * answers go to the LLM provider and into CortexActionLog.result. Kept pure
 * (no Nest, no Prisma) so both import it.
 */
export function connectionView(connection: KeyConnectorConnection): ConnectionView {
  return {
    id: connection.id,
    businessId: connection.businessId,
    providerKey: connection.providerKey,
    status: connection.status,
    displayName: connection.displayName,
    settings: connection.settings,
    lastSyncAt: connection.lastSyncAt,
    lastError: connection.lastError,
    healthScore: connection.healthScore,
    createdAt: connection.createdAt,
    updatedAt: connection.updatedAt,
  };
}
