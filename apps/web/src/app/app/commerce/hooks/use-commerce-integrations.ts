"use client";

import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import { getGmailAuthUrl, disconnectGmail } from "@/lib/client";
import { apiGet, apiPost } from "@/lib/api";

/**
 * R0-CMF5-GMAIL-CONNECT-BINDING: the business mailbox is connected, replaced
 * and disconnected by the business owner only (403 {code:'GMAIL_OWNER_ONLY'}
 * otherwise), and a Google consent links nothing until the owner who started
 * it confirms the mailbox it was completed with.
 */
export const GMAIL_OWNER_ONLY_TEXT = "Only the business owner can connect, replace or disconnect the business mailbox.";

/** What the server staged after Google consent (GET .../gmail/pending/:id). */
export interface PendingGmailConnection {
  pendingId: string;
  email: string;
  expiresAt: string;
}

type ApiFailure = { error: string | null; status?: number; rawError?: Record<string, unknown> | null };

/** The refusal message to show: the owner-only rule by its code, else the server's message. */
export function gmailRefusalMessage(res: ApiFailure, fallback: string): string {
  if (res.rawError?.code === "GMAIL_OWNER_ONLY") return GMAIL_OWNER_ONLY_TEXT;
  return res.error || fallback;
}

export function useCommerceIntegrations(businessId: string | null) {
  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; email: string | null } | null>(null);
  const [loadingGmail, setLoadingGmail] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [confirmDisconnectGmail, setConfirmDisconnectGmail] = useState(false);
  const [paymentGateways, setPaymentGateways] = useState<{ wipay: boolean; paypal: boolean }>({ wipay: false, paypal: false });
  const [pendingGmail, setPendingGmail] = useState<PendingGmailConnection | null>(null);
  const [confirmingGmail, setConfirmingGmail] = useState(false);
  /**
   * R0-CMF5 review 2 CMF5R-3: the pending id a confirmation was already sent
   * for. A staged connection is confirmed once; a second click (or a second
   * call before the first re-render) sends nothing, so the owner never sees
   * "Gmail connected" next to the server's 404 for the repeat.
   */
  const confirmSentFor = useRef<string | null>(null);

  const handleConnectGmail = useCallback(async () => {
    if (!businessId) return;
    setLoadingGmail(true);
    const res = await getGmailAuthUrl(businessId);
    setLoadingGmail(false);
    if (res.data?.url) {
      window.location.href = res.data.url;
      return;
    }
    toast.error(gmailRefusalMessage(res, "Could not start connecting Gmail"));
  }, [businessId]);

  const handleDisconnectGmail = useCallback(async () => {
    if (!businessId) return;
    const res = await disconnectGmail(businessId);
    setConfirmDisconnectGmail(false);
    if (res.error) {
      toast.error(gmailRefusalMessage(res, "Could not disconnect Gmail"));
      return;
    }
    setGmailStatus({ connected: false, email: null });
    toast.success("Gmail disconnected");
  }, [businessId]);

  /**
   * After Google consent the browser lands on /app/commerce?gmail=pending&pending=<id>.
   * Read what was staged, so the owner sees which mailbox they are about to connect.
   */
  const loadPendingGmail = useCallback(
    async (pendingId: string) => {
      if (!businessId || !pendingId) return;
      confirmSentFor.current = null;
      const res = await apiGet<PendingGmailConnection>(
        `/commerce/businesses/${encodeURIComponent(businessId)}/gmail/pending/${encodeURIComponent(pendingId)}`,
      );
      if (res.data?.email) {
        setPendingGmail(res.data);
        return;
      }
      setPendingGmail(null);
      toast.error(gmailRefusalMessage(res, "This Gmail connection is no longer pending; connect Gmail again"));
    },
    [businessId],
  );

  /** The owner's click on "Connect <email>": confirm exactly the mailbox that was shown. */
  const handleConfirmPendingGmail = useCallback(async () => {
    if (!businessId || !pendingGmail) return;
    if (confirmSentFor.current === pendingGmail.pendingId) return;
    confirmSentFor.current = pendingGmail.pendingId;
    setConfirmingGmail(true);
    const res = await apiPost<{ connected: boolean; email: string }>({
      path: `/commerce/businesses/${encodeURIComponent(businessId)}/gmail/confirm`,
      body: { pendingId: pendingGmail.pendingId, email: pendingGmail.email },
    });
    setConfirmingGmail(false);
    setPendingGmail(null);
    if (res.data?.connected) {
      setGmailStatus({ connected: true, email: res.data.email });
      toast.success(`Gmail connected: ${res.data.email}`);
      return;
    }
    toast.error(gmailRefusalMessage(res, "Could not connect Gmail"));
  }, [businessId, pendingGmail]);

  /** The owner declines: nothing is linked, and the staged connection expires on the server. */
  const handleCancelPendingGmail = useCallback(() => {
    setPendingGmail(null);
  }, []);

  return {
    gmailStatus,
    setGmailStatus,
    loadingGmail,
    showContactPicker,
    setShowContactPicker,
    handleConnectGmail,
    handleDisconnectGmail,
    confirmDisconnectGmail,
    setConfirmDisconnectGmail,
    paymentGateways,
    setPaymentGateways,
    pendingGmail,
    confirmingGmail,
    loadPendingGmail,
    handleConfirmPendingGmail,
    handleCancelPendingGmail,
  };
}
