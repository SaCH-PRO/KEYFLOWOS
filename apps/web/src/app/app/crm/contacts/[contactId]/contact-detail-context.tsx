"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { fetchContactDetail } from "@/lib/client";
import type { ContactDetail } from "@/lib/client";

interface ContactDetailContextValue {
  contact: ContactDetail["contact"] | null;
  detail: ContactDetail | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

const ContactDetailContext = createContext<ContactDetailContextValue | null>(null);

export function useContactDetailContext(): ContactDetailContextValue {
  const ctx = useContext(ContactDetailContext);
  if (!ctx) throw new Error("useContactDetailContext must be used inside ContactDetailProvider");
  return ctx;
}

export function ContactDetailProvider({ contactId, children }: { contactId: string; children: React.ReactNode }) {
  const [detail, setDetail] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => setRefreshToken((t) => t + 1), []);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setError(null);
    fetchContactDetail(contactId)
      .then((res) => {
        if (res.data) {
          setDetail(res.data);
        } else {
          setError(res.error ?? "Failed to load contact");
        }
      })
      .catch(() => setError("Failed to load contact"))
      .finally(() => setLoading(false));
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [contactId, refreshToken]);

  const value: ContactDetailContextValue = {
    contact: detail?.contact ?? null,
    detail,
    loading,
    error,
    refresh,
  };

  return <ContactDetailContext.Provider value={value}>{children}</ContactDetailContext.Provider>;
}
