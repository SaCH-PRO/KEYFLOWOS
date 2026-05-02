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
  ChevronRight,
  Link2,
  Linkedin,
  Instagram,
  Twitter,
  Users,
  ExternalLink,
  Layers,
} from "lucide-react";
import type { ContactDetailData } from "./contact-detail";

function CollapsibleSection({
  icon: Icon,
  title,
  children,
  defaultOpen = false,
  hasData = false,
  preview,
}: {
  icon: typeof Building2;
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  hasData?: boolean;
  preview?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl bg-muted/30 border border-border/50 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between p-3 hover:bg-muted/20 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex-shrink-0">{title}</span>
          {hasData && <span className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--kf-accent2))] flex-shrink-0" />}
          {!open && preview && (
            <span className="text-[10px] text-muted-foreground/60 truncate ml-1">
              {preview}
            </span>
          )}
        </div>
        <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform duration-200 flex-shrink-0 ${open ? "rotate-90" : ""}`} />
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

export type RelatedContact = {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  status?: string | null;
  jobTitle?: string | null;
};

interface ContactDetailInfoProps {
  contact: ContactDetailData;
  relatedContacts?: RelatedContact[];
  onSelectRelatedContact?: (contactId: string) => void;
}

export function ContactDetailInfo({ contact, relatedContacts, onSelectRelatedContact }: ContactDetailInfoProps) {
  const hasProfessional = !!(contact.companyName || contact.jobTitle || contact.department || contact.industry);
  const hasContactMethods = !!(contact.secondaryEmail || contact.secondaryPhone || contact.whatsappNumber || contact.preferredChannel || contact.language);
  const hasAddress = !!(contact.addressLine1 || contact.addressLine2 || contact.city || contact.state || contact.postalCode || contact.country || contact.timezone);
  const hasPreferences = contact.marketingOptIn != null || contact.doNotContact != null || contact.lifecycleStage || contact.segment;

  const customObj = (contact as { custom?: unknown })?.custom;

  const customData = customObj && typeof customObj === "object" && !Array.isArray(customObj) ? customObj as Record<string, unknown> : null;
  const reservedKeys = new Set(["linkedinUrl", "instagramUrl", "twitterUrl", "referredBy", "nextScheduledInteraction"]);
  const linkedinUrl = customData?.linkedinUrl ? String(customData.linkedinUrl) : null;
  const instagramUrl = customData?.instagramUrl ? String(customData.instagramUrl) : null;
  const twitterUrl = customData?.twitterUrl ? String(customData.twitterUrl) : null;
  const referredBy = customData?.referredBy ? String(customData.referredBy) : null;
  const nextScheduledInteraction = customData?.nextScheduledInteraction ? String(customData.nextScheduledInteraction) : null;
  const hasSocial = !!(linkedinUrl || instagramUrl || twitterUrl || referredBy || nextScheduledInteraction);
  const arbitraryCustomFields = customData ? Object.entries(customData).filter(([k]) => !reservedKeys.has(k)) : [];
  const hasCustomFields = arbitraryCustomFields.length > 0;

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

      <CollapsibleSection icon={Building2} title="Professional" hasData={hasProfessional}
        preview={hasProfessional ? [contact.jobTitle, contact.companyName].filter(Boolean).join(" at ") || undefined : undefined}
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <InfoField label="Company" value={contact.companyName} />
          <InfoField label="Job Title" value={contact.jobTitle} />
          <InfoField label="Department" value={contact.department} />
          <InfoField label="Industry" value={contact.industry} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon={Link2} title="Social & Referral" hasData={hasSocial}
        preview={hasSocial ? [linkedinUrl ? "LinkedIn" : null, instagramUrl ? "Instagram" : null, twitterUrl ? "Twitter" : null, referredBy ? `Ref: ${referredBy}` : null].filter(Boolean).join(" · ") || undefined : undefined}
      >
        <div className="space-y-2 text-sm">
          {linkedinUrl && (
            <a href={linkedinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-blue-400 hover:underline">
              <Linkedin className="w-3.5 h-3.5" /> LinkedIn <ExternalLink className="w-3 h-3 opacity-50" />
            </a>
          )}
          {instagramUrl && (
            <a href={instagramUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-pink-400 hover:underline">
              <Instagram className="w-3.5 h-3.5" /> Instagram <ExternalLink className="w-3 h-3 opacity-50" />
            </a>
          )}
          {twitterUrl && (
            <a href={twitterUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-sky-400 hover:underline">
              <Twitter className="w-3.5 h-3.5" /> Twitter <ExternalLink className="w-3 h-3 opacity-50" />
            </a>
          )}
          {referredBy && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <InfoField label="Referred By" value={referredBy} />
            </div>
          )}
          {nextScheduledInteraction && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              <InfoField label="Next Scheduled Interaction" value={new Date(nextScheduledInteraction).toLocaleString()} />
            </div>
          )}
          {!hasSocial && <p className="text-xs text-muted-foreground">No social links or referral info</p>}
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon={PhoneCall} title="Contact Methods" hasData={hasContactMethods}
        preview={hasContactMethods ? [
          contact.preferredChannel ? `${contact.preferredChannel} preferred` : null,
          contact.whatsappNumber ? "WhatsApp" : null,
          contact.language,
        ].filter(Boolean).join(" · ") || undefined : undefined}
      >
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
          <InfoField label="Secondary Email" value={contact.secondaryEmail} />
          <InfoField label="Secondary Phone" value={contact.secondaryPhone} />
          <InfoField label="WhatsApp" value={contact.whatsappNumber} />
          <InfoField label="Preferred Channel" value={contact.preferredChannel} />
          <InfoField label="Language" value={contact.language} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection icon={MapPin} title="Address" hasData={hasAddress}
        preview={hasAddress ? [contact.city, contact.country].filter(Boolean).join(", ") || undefined : undefined}
      >
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

      <CollapsibleSection icon={Tag} title="Preferences" hasData={!!hasPreferences}
        preview={hasPreferences ? [
          contact.doNotContact ? "Do Not Contact" : null,
          contact.marketingOptIn === true ? "Mktg Opt-In" : contact.marketingOptIn === false ? "Mktg Opt-Out" : null,
          contact.segment,
        ].filter(Boolean).join(" · ") || undefined : undefined}
      >
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

      {hasCustomFields && (
        <CollapsibleSection icon={Layers} title="Custom Fields" hasData>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {arbitraryCustomFields.map(([key, value]) => (
              <InfoField key={key} label={key} value={value != null ? String(value) : null} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {relatedContacts && relatedContacts.length > 0 && (
        <CollapsibleSection icon={Users} title={`Related Contacts (${relatedContacts.length})`} hasData defaultOpen>
          <div className="space-y-2">
            {relatedContacts.map((rc) => {
              const name = `${rc.firstName ?? ""} ${rc.lastName ?? ""}`.trim() || rc.email || "Unnamed";
              const statusColor: Record<string, string> = {
                LEAD: "bg-amber-500/15 text-amber-400",
                PROSPECT: "bg-blue-500/15 text-blue-400",
                CLIENT: "bg-emerald-500/15 text-emerald-400",
                LOST: "bg-red-500/15 text-red-400",
              };
              return (
                <button
                  key={rc.id}
                  onClick={() => onSelectRelatedContact?.(rc.id)}
                  className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/30 transition-colors text-left"
                >
                  <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground shrink-0">
                    {(rc.firstName?.[0] ?? "").toUpperCase()}{(rc.lastName?.[0] ?? "").toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{name}</p>
                    {rc.jobTitle && <p className="text-[10px] text-muted-foreground truncate">{rc.jobTitle}</p>}
                  </div>
                  {rc.status && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-md font-semibold ${statusColor[rc.status] ?? "bg-muted text-muted-foreground"}`}>
                      {rc.status}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </CollapsibleSection>
      )}

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
