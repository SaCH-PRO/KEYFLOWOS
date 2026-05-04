"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Mail,
  Phone,
  MessageCircle,
  MapPin,
  Tag,
  StickyNote,
  Megaphone,
  ShieldAlert,
  ShieldCheck,
  ChevronRight,
  Linkedin,
  Instagram,
  Twitter,
  Users,
  ExternalLink,
  CalendarPlus,
  Globe,
  Languages,
  Briefcase,
  ChevronDown,
} from "lucide-react";
import { updateContact } from "@/lib/client";
import { getStoredBusinessId } from "@/lib/workspace";
import { buildWhatsAppLink } from "@/lib/whatsapp";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ContactDetailData } from "./contact-detail";
import { getContactAgeGroupLabel } from "@/lib/crm-constants";

function buildMapsUrl(parts: Array<string | null | undefined>): string {
  const query = parts.filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function localTimeFor(timezone: string): string | null {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date());
  } catch {
    return null;
  }
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
  onAddTask?: (title: string, options?: { dueDate?: string; priority?: string; remindAt?: string }) => Promise<void>;
  onContactUpdated?: () => void;
}

export function ContactDetailInfo({
  contact,
  relatedContacts,
  onSelectRelatedContact,
  onAddTask,
  onContactUpdated,
}: ContactDetailInfoProps) {
  const router = useRouter();
  const [marketingOptIn, setMarketingOptIn] = useState<boolean | null | undefined>(contact.marketingOptIn);
  const [doNotContact, setDoNotContact] = useState<boolean | null | undefined>(contact.doNotContact);
  const [savingFlag, setSavingFlag] = useState<"marketing" | "dnc" | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | {
    title: string;
    message: string;
    confirmLabel: string;
    variant: "danger" | "default";
    onConfirm: () => void;
  }>(null);

  const customObj = (contact as { custom?: unknown })?.custom;
  const customData = customObj && typeof customObj === "object" && !Array.isArray(customObj) ? customObj as Record<string, unknown> : null;
  const reservedKeys = new Set(["linkedinUrl", "instagramUrl", "twitterUrl", "referredBy", "referredById", "nextScheduledInteraction"]);
  const linkedinUrl = customData?.linkedinUrl ? String(customData.linkedinUrl) : null;
  const instagramUrl = customData?.instagramUrl ? String(customData.instagramUrl) : null;
  const twitterUrl = customData?.twitterUrl ? String(customData.twitterUrl) : null;
  const referredBy = customData?.referredBy ? String(customData.referredBy) : null;
  const referredById = customData?.referredById ? String(customData.referredById) : null;
  const nextScheduledInteraction = customData?.nextScheduledInteraction ? String(customData.nextScheduledInteraction) : null;
  const arbitraryCustomFields = customData ? Object.entries(customData).filter(([k]) => !reservedKeys.has(k)) : [];

  const hasAddress = !!(contact.addressLine1 || contact.addressLine2 || contact.city || contact.state || contact.postalCode || contact.country);
  const localTime = useMemo(() => contact.timezone ? localTimeFor(contact.timezone) : null, [contact.timezone]);

  const persistFlag = async (field: "marketingOptIn" | "doNotContact", value: boolean) => {
    const businessId = getStoredBusinessId() ?? undefined;
    setSavingFlag(field === "marketingOptIn" ? "marketing" : "dnc");
    const previousMarketing = marketingOptIn;
    const previousDnc = doNotContact;
    if (field === "marketingOptIn") setMarketingOptIn(value);
    else setDoNotContact(value);
    try {
      const res = await updateContact({ businessId, contactId: contact.id, [field]: value });
      if (res.error) throw new Error(res.error);
      toast.success(field === "marketingOptIn"
        ? value ? "Marketing opt-in enabled" : "Marketing opt-in disabled"
        : value ? "Marked as Do Not Contact" : "Removed Do Not Contact");
      onContactUpdated?.();
    } catch {
      if (field === "marketingOptIn") setMarketingOptIn(previousMarketing);
      else setDoNotContact(previousDnc);
      toast.error("Could not update preference");
    } finally {
      setSavingFlag(null);
    }
  };

  const requestToggleMarketing = () => {
    const next = !(marketingOptIn === true);
    setConfirm({
      title: next ? "Enable marketing opt-in?" : "Disable marketing opt-in?",
      message: next
        ? "This contact will start receiving marketing campaigns and broadcasts. Make sure you have their consent."
        : "This contact will be excluded from future marketing campaigns and broadcasts.",
      confirmLabel: next ? "Enable opt-in" : "Disable opt-in",
      variant: "default",
      onConfirm: () => persistFlag("marketingOptIn", next),
    });
  };
  const requestToggleDnc = () => {
    const next = !(doNotContact === true);
    setConfirm({
      title: next ? "Mark as Do Not Contact?" : "Remove Do Not Contact?",
      message: next
        ? "All channels will stop sending automated messages to this contact, and outbound buttons will warn before each action. This is a compliance-sensitive change."
        : "Automated messages and outbound channels will be re-enabled for this contact.",
      confirmLabel: next ? "Mark Do Not Contact" : "Remove Do Not Contact",
      variant: next ? "danger" : "default",
      onConfirm: () => persistFlag("doNotContact", next),
    });
  };

  const handleLifecycleClick = () => {
    if (!contact.lifecycleStage) return;
    router.push(`/app/crm/pipeline?lifecycle=${encodeURIComponent(contact.lifecycleStage)}`);
  };
  const handleSegmentClick = () => {
    if (!contact.segment) return;
    router.push(`/app/crm/pipeline?segment=${encodeURIComponent(contact.segment)}`);
  };
  const handleReferredByClick = () => {
    if (!referredBy && !referredById) return;
    if (referredById && onSelectRelatedContact) {
      onSelectRelatedContact(referredById);
      return;
    }
    if (referredById) {
      router.push(`/app/crm/pipeline?contactId=${encodeURIComponent(referredById)}`);
      return;
    }
    const match = relatedContacts?.find((rc) => {
      const name = `${rc.firstName ?? ""} ${rc.lastName ?? ""}`.trim().toLowerCase();
      return name && name === (referredBy ?? "").toLowerCase();
    });
    if (match && onSelectRelatedContact) {
      onSelectRelatedContact(match.id);
    } else if (referredBy) {
      router.push(`/app/crm/pipeline?search=${encodeURIComponent(referredBy)}`);
    }
  };
  const handleScheduleInteractionTask = async () => {
    if (!nextScheduledInteraction || !onAddTask) return;
    try {
      await onAddTask(`Follow up with ${contact.firstName || "client"}`, {
        dueDate: nextScheduledInteraction,
        priority: "NORMAL",
      });
      toast.success("Task created for scheduled interaction");
    } catch {
      toast.error("Could not create task");
    }
  };

  const identityBits: Array<{ key: string; node: React.ReactNode }> = [];
  if (contact.jobTitle || contact.companyName) {
    identityBits.push({
      key: "role",
      node: (
        <span className="inline-flex items-center gap-1">
          <Briefcase className="w-3 h-3" />
          {contact.jobTitle && contact.companyName
            ? `${contact.jobTitle} · ${contact.companyName}`
            : contact.companyName || contact.jobTitle}
        </span>
      ),
    });
  }
  if (contact.city || contact.country) {
    const loc = [contact.city, contact.country].filter(Boolean).join(", ");
    identityBits.push({
      key: "loc",
      node: hasAddress ? (
        <a
          href={buildMapsUrl([contact.addressLine1, contact.addressLine2, contact.city, contact.state, contact.postalCode, contact.country])}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 hover:text-foreground hover:underline"
          title="Open in Maps"
        >
          <MapPin className="w-3 h-3" />
          {loc}
        </a>
      ) : (
        <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{loc}</span>
      ),
    });
  }
  if (contact.timezone) {
    identityBits.push({
      key: "tz",
      node: (
        <span className="inline-flex items-center gap-1" title={contact.timezone}>
          <Globe className="w-3 h-3" />
          {contact.timezone}
          {localTime && <span className="text-foreground/80 font-medium ml-0.5">· {localTime} local</span>}
        </span>
      ),
    });
  }
  if (contact.language) identityBits.push({ key: "lang", node: <span className="inline-flex items-center gap-1"><Languages className="w-3 h-3" />{contact.language}</span> });
  if (contact.preferredChannel) identityBits.push({ key: "pref", node: <span className="inline-flex items-center gap-1"><MessageCircle className="w-3 h-3" />{contact.preferredChannel} preferred</span> });

  const whatsappPhone = contact.whatsappNumber || contact.phone || null;
  const otherChannels: Array<React.ReactNode> = [];
  if (contact.secondaryEmail) {
    otherChannels.push(
      <a key="se" href={`mailto:${contact.secondaryEmail}`} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-muted/40 hover:bg-muted transition-colors text-blue-300" title={contact.secondaryEmail}>
        <Mail className="w-3 h-3" /> Alt email
      </a>
    );
  }
  if (contact.secondaryPhone) {
    otherChannels.push(
      <a key="sp" href={`tel:${contact.secondaryPhone}`} className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-muted/40 hover:bg-muted transition-colors text-violet-300" title={contact.secondaryPhone}>
        <Phone className="w-3 h-3" /> Alt phone
      </a>
    );
  }
  if (contact.whatsappNumber && whatsappPhone) {
    otherChannels.push(
      <a key="wa" href={buildWhatsAppLink(whatsappPhone)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 transition-colors text-emerald-400" title={contact.whatsappNumber}>
        <MessageCircle className="w-3 h-3" /> WhatsApp
      </a>
    );
  }

  const socialLinks: Array<React.ReactNode> = [];
  if (linkedinUrl) socialLinks.push(<a key="li" href={linkedinUrl} target="_blank" rel="noopener noreferrer" title="LinkedIn" className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"><Linkedin className="w-3.5 h-3.5" /></a>);
  if (instagramUrl) socialLinks.push(<a key="ig" href={instagramUrl} target="_blank" rel="noopener noreferrer" title="Instagram" className="p-1.5 rounded-lg bg-pink-500/10 text-pink-400 hover:bg-pink-500/20 transition-colors"><Instagram className="w-3.5 h-3.5" /></a>);
  if (twitterUrl) socialLinks.push(<a key="tw" href={twitterUrl} target="_blank" rel="noopener noreferrer" title="Twitter / X" className="p-1.5 rounded-lg bg-sky-500/10 text-sky-400 hover:bg-sky-500/20 transition-colors"><Twitter className="w-3.5 h-3.5" /></a>);

  const hasMoreDetails = !!(
    contact.department ||
    contact.industry ||
    contact.ageGroup ||
    contact.addressLine1 ||
    contact.addressLine2 ||
    contact.postalCode ||
    contact.state ||
    arbitraryCustomFields.length > 0 ||
    (relatedContacts && relatedContacts.length > 0) ||
    (contact.tags && contact.tags.length > 0)
  );

  const ToggleChip = ({
    active, onClick, activeClass, inactiveClass, icon: Icon, label, saving,
  }: {
    active: boolean;
    onClick: () => void;
    activeClass: string;
    inactiveClass: string;
    icon: typeof Megaphone;
    label: string;
    saving: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      aria-pressed={active}
      className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors disabled:opacity-60 ${active ? activeClass : inactiveClass}`}
      title={`Click to ${active ? "disable" : "enable"} ${label}`}
    >
      <Icon className="w-3 h-3" />
      {label}
      <span className={`ml-1 inline-block w-2 h-2 rounded-full ${active ? "bg-current" : "bg-current opacity-30"}`} />
    </button>
  );

  return (
    <div className="space-y-3 rounded-xl border border-border/50 bg-muted/20 p-3">
      <div className="flex items-center gap-2 mb-1">
        <Users className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Contact &amp; Channels</span>
      </div>

      {identityBits.length > 0 && (
        <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
          {identityBits.map((p, idx) => (
            <span key={p.key} className="inline-flex items-center gap-2">
              {idx > 0 && <span className="text-muted-foreground/40">·</span>}
              {p.node}
            </span>
          ))}
        </div>
      )}

      {(otherChannels.length > 0 || socialLinks.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {otherChannels}
          {socialLinks.length > 0 && (
            <div className="flex items-center gap-1 ml-1">
              {socialLinks}
            </div>
          )}
        </div>
      )}

      {(contact.lifecycleStage || contact.segment) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {contact.lifecycleStage && (
            <button
              onClick={handleLifecycleClick}
              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))] border border-[hsl(var(--kf-accent2))]/30 hover:bg-[hsl(var(--kf-accent2))]/25 transition-colors"
              title={`Filter pipeline by ${contact.lifecycleStage}`}
            >
              {contact.lifecycleStage}
              <ChevronRight className="w-2.5 h-2.5" />
            </button>
          )}
          {contact.segment && (
            <button
              onClick={handleSegmentClick}
              className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/30 hover:bg-blue-500/20 transition-colors"
              title={`Filter pipeline by ${contact.segment}`}
            >
              {contact.segment}
              <ChevronRight className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <ToggleChip
          active={marketingOptIn === true}
          onClick={requestToggleMarketing}
          activeClass="bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
          inactiveClass="bg-muted text-muted-foreground border-border/50 hover:bg-muted/80"
          icon={Megaphone}
          label={marketingOptIn === true ? "Marketing Opt-In" : "Marketing Opt-Out"}
          saving={savingFlag === "marketing"}
        />
        <ToggleChip
          active={doNotContact === true}
          onClick={requestToggleDnc}
          activeClass="bg-red-500/10 text-red-400 border-red-500/30"
          inactiveClass="bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
          icon={doNotContact === true ? ShieldAlert : ShieldCheck}
          label={doNotContact === true ? "Do Not Contact" : "Contactable"}
          saving={savingFlag === "dnc"}
        />
      </div>

      {contact.notesInternal && (
        <div className="p-2.5 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
          <div className="flex items-center gap-2 mb-1">
            <StickyNote className="w-3 h-3 text-yellow-500" />
            <span className="text-[10px] font-medium text-yellow-500 uppercase tracking-wider">Internal note</span>
          </div>
          <p className="text-xs whitespace-pre-wrap">{contact.notesInternal}</p>
        </div>
      )}

      {(referredBy || nextScheduledInteraction) && (
        <div className="space-y-1.5">
          {referredBy && (
            <button
              onClick={handleReferredByClick}
              className="w-full flex items-center justify-between text-xs px-2 py-1.5 rounded-lg bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 transition-colors"
              title="Open referring contact"
            >
              <span className="inline-flex items-center gap-1.5"><Users className="w-3 h-3" /> Referred by {referredBy}</span>
              <ChevronRight className="w-3 h-3 opacity-60" />
            </button>
          )}
          {nextScheduledInteraction && (
            <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-2 py-1.5">
              <div className="flex flex-col min-w-0">
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Next interaction</span>
                <span className="text-xs font-medium truncate">{new Date(nextScheduledInteraction).toLocaleString()}</span>
              </div>
              {onAddTask && (
                <button
                  onClick={handleScheduleInteractionTask}
                  className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))] hover:bg-[hsl(var(--kf-accent2))]/25 transition-colors shrink-0"
                  title="Create a task for this interaction"
                >
                  <CalendarPlus className="w-3 h-3" /> Add task
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {hasAddress && (
        <a
          href={buildMapsUrl([contact.addressLine1, contact.addressLine2, contact.city, contact.state, contact.postalCode, contact.country])}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-1 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
        >
          <MapPin className="w-3 h-3" /> Open address in Maps <ExternalLink className="w-2.5 h-2.5 opacity-60" />
        </a>
      )}

      {hasMoreDetails && (
        <div className="rounded-lg border border-border/40 bg-background/30">
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className="w-full flex items-center justify-between px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <span>More details</span>
            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
          </button>
          {moreOpen && (
            <div className="px-2.5 pb-2.5 space-y-2">
              {(contact.department || contact.industry || contact.ageGroup) && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {contact.department && <div><span className="text-muted-foreground text-[10px] block">Department</span>{contact.department}</div>}
                  {contact.industry && <div><span className="text-muted-foreground text-[10px] block">Industry</span>{contact.industry}</div>}
                  {contact.ageGroup && <div><span className="text-muted-foreground text-[10px] block">Age Group</span>{getContactAgeGroupLabel(contact.ageGroup)}</div>}
                </div>
              )}
              {(contact.addressLine1 || contact.addressLine2 || contact.state || contact.postalCode) && (
                <div className="text-xs leading-snug">
                  <span className="text-muted-foreground text-[10px] block mb-0.5">Address</span>
                  {[contact.addressLine1, contact.addressLine2, [contact.city, contact.state, contact.postalCode].filter(Boolean).join(" "), contact.country]
                    .filter(Boolean)
                    .map((line, i) => (<div key={i}>{line}</div>))}
                </div>
              )}
              {arbitraryCustomFields.length > 0 && (
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  {arbitraryCustomFields.map(([k, v]) => (
                    <div key={k}>
                      <span className="text-muted-foreground text-[10px] block">{k}</span>
                      {v != null ? String(v) : "—"}
                    </div>
                  ))}
                </div>
              )}
              {relatedContacts && relatedContacts.length > 0 && (
                <div className="space-y-1">
                  <span className="text-muted-foreground text-[10px] uppercase tracking-wider">Related contacts</span>
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
                        className="w-full flex items-center gap-2 p-1.5 rounded-md hover:bg-muted/30 transition-colors text-left"
                      >
                        <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-[10px] font-semibold text-muted-foreground shrink-0">
                          {(rc.firstName?.[0] ?? "").toUpperCase()}{(rc.lastName?.[0] ?? "").toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium truncate">{name}</p>
                          {rc.jobTitle && <p className="text-[10px] text-muted-foreground truncate">{rc.jobTitle}</p>}
                        </div>
                        {rc.status && (
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-semibold ${statusColor[rc.status] ?? "bg-muted text-muted-foreground"}`}>
                            {rc.status}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {contact.tags && contact.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {contact.tags.map((tag) => (
                    <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted text-muted-foreground inline-flex items-center gap-1">
                      <Tag className="w-2.5 h-2.5" />
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={!!confirm}
        title={confirm?.title ?? ""}
        message={confirm?.message ?? ""}
        confirmLabel={confirm?.confirmLabel ?? "Confirm"}
        variant={confirm?.variant ?? "default"}
        onConfirm={() => {
          confirm?.onConfirm();
          setConfirm(null);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}
