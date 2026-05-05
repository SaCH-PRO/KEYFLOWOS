"use client";

import { useState } from "react";
import { Button, Input } from "@keyflow/ui";
import { toast } from "sonner";
import { referContact } from "@/lib/client";

interface ReferContactDialogProps {
  open: boolean;
  contactId: string;
  contactName?: string;
  businessId?: string;
  onClose: () => void;
  onCreated?: (targetContactId: string) => void;
}

export function ReferContactDialog({
  open,
  contactId,
  contactName,
  businessId,
  onClose,
  onCreated,
}: ReferContactDialogProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const handleSubmit = async () => {
    if (!firstName.trim() && !lastName.trim() && !email.trim() && !phone.trim()) {
      toast.error("Add a name, email, or phone for the referred contact");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error } = await referContact({
        contactId,
        target: { firstName, lastName, email, phone },
        note: note || null,
        businessId,
      });
      if (error || !data) throw new Error(error || "Failed to refer contact");
      toast.success("Referral logged");
      onCreated?.(data.targetContactId);
      onClose();
      setFirstName("");
      setLastName("");
      setEmail("");
      setPhone("");
      setNote("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl bg-background border border-border p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <h3 className="text-base font-semibold">Refer a contact</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Capture a referral from {contactName || "this contact"}. They&apos;ll be linked as the referrer.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Input placeholder="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
          <Input placeholder="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <Input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" />
        <Input placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
        <textarea
          className="w-full rounded-md border border-border bg-background p-2 text-sm min-h-[60px]"
          placeholder="Context for the referral (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Saving…" : "Log referral"}
          </Button>
        </div>
      </div>
    </div>
  );
}
