"use client";

import { useState } from "react";
import {
  Building2,
  PhoneCall,
  MapPin,
  Tag,
  StickyNote,
  Megaphone,
  ShieldAlert,
  ShieldCheck,
  ChevronDown,
} from "lucide-react";
import type { ContactDetailData } from "./contact-detail";

function CollapsibleSection({
  icon: Icon,
  title,
  children,
  defaultOpen = false,
  hasData = false,
}: {
  icon: typeof Building2;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  hasData?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen || hasData);

  return (
    <div className="rounded-xl bg-muted/30 border border-border/50 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</span>
          {hasData && <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--kf-accent2))]" />}
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-3 pb-3">{children}</div>}
    </div>
  );
}

function InfoField({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <span className="text-xs text-muted-foreground">{label}</span>
      <p className="font-medium">{value || "—"}</p>
    </div>
  );
}

interface ContactDetailInfoProps {
  contact: ContactDetailData;
}

export function ContactDetailInfo({ contact }: ContactDetailInfoProps) {
  const hasProfessional = !!(contact.companyName || contact.jobTitle || contact.department || contact.industry);
  const hasContactMethods = !!(contact.secondaryEmail || contact.secondaryPhone || contact.whatsappNumber || contact.preferredChannel || contact.language);
  const hasAddress = !!(contact.addressLine1 || contact.addressLine2 || contact.city || contact.state || contact.postalCode || contact.country || contact.timezone);

  return (
    <>
      {contact.notesInternal && (
        <div className="p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/30">
          <div className="flex items-center gap-2 mb-1">
            <StickyNote className="w-3.5 h-3.5 text-yellow-500" />
            <span className="text-xs font-medium text-yellow-500 uppercase tracking-wider">Internal Notes</span>
          </div>
          <p className="text-sm whitespace-pre-wrap">{contact.notesInternal}</p>
        </div>
      )}

      <CollapsibleSection icon={Building2} title="Professional" hasData={hasProfessional}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <InfoField label="Company" value={contact.companyName} />
          <InfoField label="Job Title" value={contact.jobTitle} />
          <InfoField label="Department" value={contact.department} />
          <InfoField label="Industry" value={contact.industry} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon={PhoneCall} title="Contact Methods" hasData={hasContactMethods}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <InfoField label="Secondary Email" value={contact.secondaryEmail} />
          <InfoField label="Secondary Phone" value={contact.secondaryPhone} />
          <InfoField label="WhatsApp" value={contact.whatsappNumber} />
          <InfoField label="Preferred Channel" value={contact.preferredChannel} />
          <InfoField label="Language" value={contact.language} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon={MapPin} title="Address" hasData={hasAddress}>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <div className="col-span-2">
            <InfoField label="Address Line 1" value={contact.addressLine1} />
          </div>
          <div className="col-span-2">
            <InfoField label="Address Line 2" value={contact.addressLine2} />
          </div>
          <InfoField label="City" value={contact.city} />
          <InfoField label="State" value={contact.state} />
          <InfoField label="Postal Code" value={contact.postalCode} />
          <InfoField label="Country" value={contact.country} />
          <InfoField label="Timezone" value={contact.timezone} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon={Tag} title="Preferences" defaultOpen>
        <div className="flex flex-wrap gap-2 mb-2">
          {contact.marketingOptIn === true && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
              <Megaphone className="w-3 h-3" />
              Marketing Opt-In
            </span>
          )}
          {contact.marketingOptIn === false && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-muted text-muted-foreground border border-border/50">
              <Megaphone className="w-3 h-3" />
              Marketing Opt-Out
            </span>
          )}
          {contact.marketingOptIn == null && (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-muted text-muted-foreground border border-border/50">
              <Megaphone className="w-3 h-3" />
              Marketing: —
            </span>
          )}
          {contact.doNotContact ? (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-red-500/10 text-red-400 border border-red-500/30">
              <ShieldAlert className="w-3 h-3" />
              Do Not Contact
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/30">
              <ShieldCheck className="w-3 h-3" />
              Contactable
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <InfoField label="Lifecycle Stage" value={contact.lifecycleStage} />
          <InfoField label="Segment" value={contact.segment} />
        </div>
      </CollapsibleSection>

      {contact.tags && contact.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {contact.tags.map((tag) => (
            <span
              key={tag}
              className="text-xs px-2 py-1 rounded-lg bg-muted text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </>
  );
}
