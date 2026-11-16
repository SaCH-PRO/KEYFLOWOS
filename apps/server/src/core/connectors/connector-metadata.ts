import type { PrismaService } from '../prisma/prisma.service';

/**
 * SWEEP-P0-FOLLOWUP (round 3 recheck CW3-2, and the census rule it set): a connector row's metadata
 * (connector_statuses.metadata) also holds the connector's credentials (encryptedCredentials,
 * ConnectorCredentialsService), its binder (boundBy) and its verification record (whatsappVerification), which only
 * the binding doors write. A writer that read the metadata and wrote it back whole (`{ ...meta, key: value }`) wrote
 * those keys back as it had read them, over a revoke or a disconnect that committed in between.
 *
 * This writes only the keys it is given, merged in SQL over the row as it stands (`metadata || patch`), after making
 * sure the row exists (a bare 'disconnected' row; a stored one is not touched). A key that binds is refused.
 */
export const CONNECTOR_BINDING_METADATA_KEYS: ReadonlySet<string> = new Set(['encryptedCredentials', 'boundBy', 'whatsappVerification']);

type MetadataDb = Pick<PrismaService['client'], 'connectorStatus' | '$executeRaw'>;

export async function mergeConnectorMetadata(
  db: MetadataDb,
  businessId: string,
  connectorType: string,
  patch: Record<string, unknown>,
): Promise<void> {
  for (const key of Object.keys(patch)) {
    if (CONNECTOR_BINDING_METADATA_KEYS.has(key)) throw new Error(`mergeConnectorMetadata does not write the binding key ${key}`);
  }
  await db.connectorStatus.upsert({
    where: { businessId_connectorType: { businessId, connectorType } },
    create: { businessId, connectorType, status: 'disconnected' },
    update: {},
  });
  await db.$executeRaw`
    UPDATE connector_statuses
    SET metadata = COALESCE(metadata, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb, updated_at = NOW()
    WHERE business_id = ${businessId} AND connector_type = ${connectorType}`;
}
