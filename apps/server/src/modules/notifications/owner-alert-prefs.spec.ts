/**
 * OWNER-ALERTS-WEB (D-154): the owner's alert toggles (bookings, payments, claims) are saved through the route
 * Settings > Notifications already uses, PATCH /notifications/businesses/:id/customer-preferences (settings write,
 * FU-NOTIFICATIONS-PREFS-GUARD). OwnerAlertsListener reads them from Business.notificationPreferences as
 * `owner_alert_<category>` (resolveOwnerAlertPreferences). updatePreferences keeps only the keys it knows, and it knew
 * none of the owner alert keys, so an owner who turned an alert off was answered 200 and nothing changed.
 *
 *   OAP-01  RED-BEFORE  updatePreferences saves owner_alert_bookings / _payments / _claims, and the listener's own
 *                       resolver then reads that category as off
 *   OAP-02  RED-BEFORE  getPreferences answers the three keys, on by default (the listener's default)
 *   OAP-03  control     an unknown key and a non-boolean owner alert value are still dropped
 */
import { describe, it, expect, vi } from 'vitest';
import { TransactionalEmailService } from './transactional-email.service';
import { resolveOwnerAlertPreferences } from './owner-alerts.listener';

const BIZ = 'biz_oap';

function makeService(stored: Record<string, unknown> | null) {
  let current: unknown = stored;
  const update = vi.fn(async ({ data }: { data: { notificationPreferences: unknown } }) => {
    current = data.notificationPreferences;
    return {};
  });
  const findUnique = vi.fn(async () => ({ notificationPreferences: current }));
  const service = Object.assign(Object.create(TransactionalEmailService.prototype), {
    prisma: { client: { business: { findUnique, update } } },
  }) as TransactionalEmailService;
  return { service, update, stored: () => current as Record<string, unknown> };
}

describe('OWNER-ALERTS-WEB: the owner alert toggles are saved where the listener reads them', () => {
  it('OAP-01 RED-BEFORE: each owner alert toggle is saved, and the listener then reads that category as off', async () => {
    for (const category of ['bookings', 'payments', 'claims'] as const) {
      const { service, update, stored } = makeService({ payment_receipt: false });
      const key = `owner_alert_${category}`;
      const answer = (await service.updatePreferences(BIZ, { [key]: false } as never)) as Record<string, unknown>;
      expect(answer[key], `${key} answered`).toBe(false);
      expect(update).toHaveBeenCalledTimes(1);
      expect(stored()[key], `${key} saved`).toBe(false);
      expect(resolveOwnerAlertPreferences(stored(), category).enabled, `${category} off`).toBe(false);
      for (const other of ['bookings', 'payments', 'claims'] as const) {
        if (other !== category) expect(resolveOwnerAlertPreferences(stored(), other).enabled, `${other} still on`).toBe(true);
      }
      // A customer email toggle is untouched by an owner alert toggle.
      expect(stored().payment_receipt).toBe(false);

      // And back on.
      await service.updatePreferences(BIZ, { [key]: true } as never);
      expect(stored()[key]).toBe(true);
      expect(resolveOwnerAlertPreferences(stored(), category).enabled).toBe(true);
    }
  });

  it('OAP-02 RED-BEFORE: getPreferences answers the three owner alert keys, on by default', async () => {
    const fresh = (await makeService(null).service.getPreferences(BIZ)) as Record<string, unknown>;
    expect(fresh.owner_alert_bookings).toBe(true);
    expect(fresh.owner_alert_payments).toBe(true);
    expect(fresh.owner_alert_claims).toBe(true);
    const off = (await makeService({ owner_alert_claims: false }).service.getPreferences(BIZ)) as Record<string, unknown>;
    expect(off.owner_alert_claims).toBe(false);
    expect(off.owner_alert_bookings).toBe(true);
  });

  it('OAP-03 control: an unknown key and a non-boolean owner alert value are still dropped', async () => {
    const { service, stored } = makeService({});
    await service.updatePreferences(BIZ, { owner_alert_bookings: 'no', owner_alert_everything: false, injectedKey: true } as never);
    expect(stored()).not.toHaveProperty('owner_alert_everything');
    expect(stored()).not.toHaveProperty('injectedKey');
    expect(stored().owner_alert_bookings).not.toBe('no');
  });
});
