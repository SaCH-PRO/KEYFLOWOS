"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";
import { getGmailAuthUrl, disconnectGmail } from "@/lib/client";

export function useCommerceIntegrations(businessId: string | null) {
  const [gmailStatus, setGmailStatus] = useState<{ connected: boolean; email: string | null } | null>(null);
  const [loadingGmail, setLoadingGmail] = useState(false);
  const [showContactPicker, setShowContactPicker] = useState(false);
  const [confirmDisconnectGmail, setConfirmDisconnectGmail] = useState(false);
  const [paymentGateways, setPaymentGateways] = useState<{ wipay: boolean; paypal: boolean }>({ wipay: false, paypal: false });

  const handleConnectGmail = useCallback(async () => {
    if (!businessId) return;
    setLoadingGmail(true);
    const res = await getGmailAuthUrl(businessId);
    if (res.data?.url) window.location.href = res.data.url;
    setLoadingGmail(false);
  }, [businessId]);

  const handleDisconnectGmail = useCallback(async () => {
    if (!businessId) return;
    await disconnectGmail(businessId);
    setGmailStatus({ connected: false, email: null });
    toast.success("Gmail disconnected");
    setConfirmDisconnectGmail(false);
  }, [businessId]);

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
  };
}
