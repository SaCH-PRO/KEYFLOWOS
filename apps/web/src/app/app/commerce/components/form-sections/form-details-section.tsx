"use client";

import { motion } from "framer-motion";
import { Calendar, User } from "lucide-react";
import { ContactSelect } from "@/components/contacts";
import { Contact } from "@/lib/client";
import { PAYMENT_TERMS } from "../commerce-types";
import { SectionHeader } from "../billing-form-modal";

interface FormDetailsSectionProps {
  open: boolean;
  onToggle: () => void;
  accentColor: string;
  docType: string;
  contactId: string;
  onContactChange: (id: string) => void;
  contacts: Contact[];
  dateValue: string;
  onDateChange: (value: string) => void;
  dateLabel: string;
  label: string;
  onPaymentTermsChange?: (term: string) => void;
}

export function FormDetailsSection({
  open,
  onToggle,
  accentColor,
  docType,
  contactId,
  onContactChange,
  contacts,
  dateValue,
  onDateChange,
  dateLabel,
  label,
  onPaymentTermsChange,
}: FormDetailsSectionProps) {
  return (
    <>
      <SectionHeader label={`${label} Details`} icon={User} open={open} onToggle={onToggle} accentColor={accentColor} />
      {open && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="space-y-4 pb-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ContactSelect
              value={contactId}
              onChange={onContactChange}
              contacts={contacts}
              label={docType === "invoice" ? "Client (optional)" : "Client"}
              required={docType === "quote"}
            />
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" /> {dateLabel}
              </label>
              <input type="date" value={dateValue} onChange={(e) => onDateChange(e.target.value)} className="kf-input w-full" />
            </div>
          </div>

          {docType === "invoice" && onPaymentTermsChange && (
            <div className="space-y-1.5">
              <label className="text-xs text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3 h-3" /> Payment Terms
              </label>
              <div className="flex flex-wrap gap-2">
                {PAYMENT_TERMS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => onPaymentTermsChange(t.value)}
                    className="px-3 min-h-[44px] text-xs rounded-lg border border-border/50 bg-white/[0.03] hover:bg-white/[0.08] text-muted-foreground hover:text-foreground transition-all"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </motion.div>
      )}
    </>
  );
}
