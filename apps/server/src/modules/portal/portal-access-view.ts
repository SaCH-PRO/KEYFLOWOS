/**
 * A PortalAccess grant as a KEY tool answers it: without its bearer token.
 *
 * W11-KEY-ORGAN-OUTPUT-REDACT. Every PortalService method returns the raw row,
 * `token` included, and /app/portal shows it on purpose (staff copy the
 * `/portal/{token}` link and send it). A tool's answer is different: it goes to
 * the LLM provider and, through KeyCortexToolRegistryService.audit, into
 * CortexActionLog.result, where a token is durable and quotable. Whoever holds
 * the token reads that contact's invoices, projects and bookings without
 * logging in.
 *
 * The same fields as FlowOrchestratorService.redactPortalAccess (the flow twin
 * portal_grant_access); organ-tool-output-redaction.spec pins the two
 * together. As there: `delete row.token` alone would leave the model saying
 * "access exists" with no way to tell a live grant from an expired or revoked
 * one, so the useful part is restated as a boolean (`hasLiveLink`); and this is
 * an allowlist, not a delete, so a future column named `secret` or
 * `signingKey` is not answered either. Pure (no Nest, no Prisma).
 */
export interface PortalAccessView {
  id: unknown;
  contactId: unknown;
  enabled: unknown;
  settings: unknown;
  expiresAt: unknown;
  lastAccessedAt: unknown;
  accessCount: unknown;
  /** The grant is enabled and not yet expired: its link opens the portal now. */
  hasLiveLink: boolean;
  createdAt: unknown;
}

export function portalAccessView(row: Record<string, unknown>): PortalAccessView {
  const expiresAt = row.expiresAt instanceof Date ? row.expiresAt : new Date(String(row.expiresAt));
  const live = row.enabled === true && expiresAt.getTime() > Date.now();
  return {
    id: row.id,
    contactId: row.contactId,
    enabled: row.enabled,
    settings: row.settings,
    expiresAt: row.expiresAt,
    lastAccessedAt: row.lastAccessedAt ?? null,
    accessCount: row.accessCount ?? 0,
    hasLiveLink: live,
    createdAt: row.createdAt,
  };
}
