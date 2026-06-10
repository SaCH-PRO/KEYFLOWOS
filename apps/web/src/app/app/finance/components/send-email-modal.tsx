"use client";

import { useEffect } from "react";
import { useCompose } from "@/components/email/compose-context";

interface SendEmailModalProps {
  businessId: string | null;
  record: { type: "quote" | "invoice"; id: string; number: string; contact?: { email?: string | null } | null } | null;
  onClose: () => void;
  onSent?: () => void;
}

export function SendEmailModal({ record, onClose, onSent }: SendEmailModalProps) {
  const { open: openComposer } = useCompose();

  useEffect(() => {
    if (!record) return;
    const contactEmail = record.contact?.email ?? "";
    const contextType = record.type === "quote" ? "quote" : "invoice";
    const subject = record.type === "quote" ? `Quote ${record.number}` : `Invoice ${record.number}`;

    openComposer({
      to: contactEmail,
      subject,
      body: "",
      context: {
        type: contextType,
        recordNumber: record.number,
      },
      onSent,
    });

    // Parent modal wrapper closes immediately; the global composer handles the real UX.
    onClose();
  }, [record, openComposer, onClose, onSent]);

  return null;
}
