'use client';

import { useEffect } from 'react';
import { PublicPageState } from '@/components/ui/public-page-state';

/**
 * Retired: the embeddable bare-id pay widget.
 *
 * V1-46b-TOKEN-PAY-COMPLETE (M34, review ST-2; D-07, ruled 2026-10-31 by the
 * owner: token links only, the bare-id pay page is retired). This widget read
 * the bare-id public invoice and started the generic checkout and the PayPal
 * capture with the bare invoice id, so anyone holding the id
 * could keep paying through it after the business deactivated or let the
 * link expire. Customers pay at /pay/link/[token]; the operator's attendee
 * row now opens the invoice's token link instead of this page.
 *
 * Nothing is read or written here: the widget shows the same state as the
 * retired /pay/[invoiceId] page and still tells an embedding page its height.
 */
export default function RetiredPayWidgetPage() {
  useEffect(() => {
    if (window.parent !== window) {
      window.parent.postMessage({ type: 'KEYFLOW_WIDGET_RESIZE', height: document.body.scrollHeight }, '*');
    }
  }, []);

  return (
    <PublicPageState
      variant="empty"
      title="This payment address is no longer used"
      message="For your security, invoices are now paid only through the secure payment link the business sent you. Please use that link, or contact the business for a new one."
    />
  );
}
