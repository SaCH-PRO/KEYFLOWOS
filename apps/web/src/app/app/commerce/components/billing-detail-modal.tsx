"use client";

import { type ReactNode, useEffect, useCallback, useRef, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { InfoBadge } from "@/components/ui/info-badge";
import {
  FileText,
  X,
  Calendar,
  Mail,
  Phone,
  MessageCircle,
  Hash,
  Package,
  StickyNote,
  ChevronRight,
  Eye,
  Printer,
  User,
  Brain,
  Sparkles,
  Send,
  Shield,
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Activity,
} from "lucide-react";
import { formatAmount, getContactInitials } from "../utils/commerce-utils";
import {
  getStatusBadge,
  BILLING_DOC_THEME,
  type BillingDocType,
} from "./commerce-types";
import { TemplateCustomizer } from "./invoice-templates/template-customizer";
import { InvoiceTemplateRenderer } from "./invoice-templates/template-renderer";
import { printFromRef } from "./invoice-templates/print-document";
import type { TemplateId, InvoiceTemplateData } from "./invoice-templates/template-types";

export interface BusinessDataForPreview {
  name: string;
  logoUrl?: string | null;
  address?: string | null;
  city?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  tagline?: string | null;
  primaryColor: string;
  secondaryColor: string;
  invoiceTemplate?: string | null;
}

interface BillingDetailModalProps {
  type: BillingDocType;
  number: string;
  status: string;
  contact: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  contactId?: string | null;
  total: number;
  currency: string;
  items: Array<{
    id?: string;
    description?: string | null;
    quantity?: number;
    unitPrice?: number;
    total?: number;
    productId?: string | null;
  }>;
  dateLabel1: string;
  dateValue1: string | null;
  dateLabel2: string;
  dateValue2: string | null;
  dateExtra?: ReactNode;
  taxRate: number;
  discountType?: string | null;
  discountValue?: number | null;
  notes?: string | null;
  alerts?: ReactNode;
  actions: ReactNode;
  onClose: () => void;
  businessData?: BusinessDataForPreview | null;
  onSaveBranding?: (overrides: Record<string, string>) => Promise<void>;
  savingBranding?: boolean;
  onViewContact?: (contactId: string) => void;
  onViewClientIntel?: (contactId: string) => void;
  onSelectProduct?: (productId: string) => void;
  onAiDraftReminder?: (invoiceId: string) => void;
  allInvoices?: Array<{ id: string; contactId?: string | null; status?: string; total?: number; invoiceNumber?: string | null; createdAt?: string | Date | null; dueDate?: string | null }>;
}

const STATUS_ORDER_QUOTE = ["DRAFT", "SENT", "ACCEPTED", "REJECTED"];
const STATUS_ORDER_INVOICE = ["DRAFT", "SENT", "PAID", "OVERDUE", "VOID"];

function StatusPipeline({
  status,
  type,
  accentColor,
}: {
  status: string;
  type: BillingDocType;
  accentColor: string;
}) {
  const steps = type === "quote" ? STATUS_ORDER_QUOTE : STATUS_ORDER_INVOICE;
  const currentIdx = steps.indexOf(status);

  return (
    <div className="flex items-center gap-1">
      {steps.map((step, idx) => {
        const isActive = step === status;
        const isPast = idx < currentIdx;
        return (
          <div key={step} className="flex items-center gap-1">
            {idx > 0 && (
              <ChevronRight
                className="w-3 h-3 shrink-0"
                style={{
                  color:
                    isPast || isActive
                      ? accentColor
                      : "rgba(148,163,184,0.5)",
                }}
              />
            )}
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-md transition-all"
              style={
                isActive
                  ? {
                      backgroundColor: `${accentColor}22`,
                      color: accentColor,
                      border: `1px solid ${accentColor}44`,
                    }
                  : isPast
                    ? { color: accentColor, opacity: 0.6 }
                    : { color: "rgba(148,163,184,0.55)" }
              }
            >
              {step.charAt(0) + step.slice(1).toLowerCase()}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function BillingDetailModal({
  type,
  number,
  status,
  contact,
  contactId,
  total,
  currency,
  items,
  dateLabel1,
  dateValue1,
  dateLabel2,
  dateValue2,
  dateExtra,
  taxRate,
  discountType,
  discountValue,
  notes,
  alerts,
  actions,
  onClose,
  businessData,
  onSaveBranding,
  savingBranding,
  onViewContact,
  onViewClientIntel,
  onSelectProduct,
  onAiDraftReminder,
  allInvoices = [],
}: BillingDetailModalProps) {
  const theme = BILLING_DOC_THEME[type];
  const panelRef = useRef<HTMLDivElement>(null);
  const printTemplateRef = useRef<HTMLDivElement>(null);
  const dialogId = `billing-detail-${type}-${number}`;
  const [showTemplatePreview, setShowTemplatePreview] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    const prevActive = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      prevActive?.focus();
    };
  }, [handleKeyDown]);

  const handlePrint = useCallback(() => {
    const docType = type === "invoice" ? "Invoice" : "Quote";
    printFromRef(printTemplateRef, docType, number);
  }, [type, number]);

  const templateId: TemplateId = (businessData?.invoiceTemplate as TemplateId) || "classic";

  const subtotal = items.reduce(
    (sum, item) => sum + Number(item.total || 0),
    0,
  );
  const taxAmount = subtotal * ((taxRate || 0) / 100);
  let discountAmount = 0;
  if (discountValue) {
    discountAmount =
      discountType === "PERCENT"
        ? subtotal * (Number(discountValue) / 100)
        : Number(discountValue);
  }

  const templateData: InvoiceTemplateData | null = businessData
    ? {
        type: type === "invoice" ? "invoice" : "quote",
        number,
        status,
        issueDate: dateValue1,
        dueDate: type === "invoice" ? dateValue2 : null,
        expiryDate: type === "quote" ? dateValue2 : null,
        contact,
        items,
        subtotal,
        taxRate: taxRate || 0,
        taxAmount,
        discountType: discountType,
        discountValue: discountValue ? Number(discountValue) : null,
        discountAmount,
        total,
        currency,
        notes,
        business: {
          name: businessData.name,
          logoUrl: businessData.logoUrl || null,
          address: businessData.address,
          city: businessData.city,
          country: businessData.country,
          phone: businessData.phone,
          email: businessData.email,
          website: businessData.website,
          tagline: businessData.tagline,
          primaryColor: businessData.primaryColor,
          secondaryColor: businessData.secondaryColor,
        },
      }
    : null;

  const contactName = contact
    ? `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || "Unknown"
    : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogId}
        tabIndex={-1}
        className="absolute right-0 top-0 bottom-0 w-full max-w-[520px] bg-card border-l border-border/60 shadow-2xl flex-col hidden sm:flex outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="relative overflow-hidden border-b border-border/40"
          style={{
            background: `linear-gradient(135deg, ${theme.accentColor}15 0%, transparent 60%)`,
          }}
        >
          <div className="absolute top-0 right-0 w-40 h-40 rounded-full opacity-[0.04]" style={{ background: theme.accentColor, filter: "blur(40px)" }} />

          <div className="relative p-5 pb-4">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3">
                <div
                  className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
                  style={{
                    backgroundColor: `${theme.accentColor}18`,
                    border: `1px solid ${theme.accentColor}30`,
                  }}
                >
                  <FileText
                    className="w-5 h-5"
                    style={{ color: theme.accentColor }}
                  />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 id={dialogId} className="text-lg font-bold">
                      {theme.label} #{number}
                    </h2>
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none ${getStatusBadge(status)}`}
                    >
                      {status}
                    </span>
                  </div>
                  <div className="mt-1">
                    <StatusPipeline
                      status={status}
                      type={type}
                      accentColor={theme.accentColor}
                    />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {businessData && (
                  <button
                    onClick={handlePrint}
                    className="p-2 rounded-xl hover:bg-white/[0.06] transition-colors"
                    aria-label="Print"
                    title="Print / Save as PDF"
                  >
                    <Printer className="w-4.5 h-4.5" style={{ color: theme.accentColor }} />
                  </button>
                )}
                <button
                  onClick={onClose}
                  className="p-2 rounded-xl hover:bg-white/[0.06] transition-colors"
                  aria-label="Close"
                >
                  <X className="w-5 h-5 text-muted-foreground" />
                </button>
              </div>
            </div>

            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-0.5">
                  Total Amount
                </p>
                <p
                  className="text-3xl font-extrabold tracking-tight"
                  style={{ color: theme.accentColor }}
                >
                  {formatAmount(total, currency)}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Hash className="w-3 h-3" />
                <span>{items.length} item{items.length !== 1 ? "s" : ""}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="p-5 space-y-4">
            {contact && contactName && (
              <div className="rounded-2xl bg-white/[0.03] border border-border/40 overflow-hidden">
                <div className="p-3.5 flex items-center gap-3">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0"
                    style={{ backgroundColor: theme.avatarBg }}
                  >
                    <span className={theme.avatarText}>
                      {getContactInitials(contact)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm truncate">
                      {contactName}
                    </p>
                    {contact.email && (
                      <p className="text-xs text-muted-foreground truncate">
                        {contact.email}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center border-t border-border/30">
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 hover:bg-blue-500/10 transition-colors text-xs text-blue-400"
                      title={`Email ${contact.email}`}
                    >
                      <Mail className="w-3.5 h-3.5" />
                      Email
                    </a>
                  )}
                  {contact.phone && (
                    <>
                      {contact.email && (
                        <div className="w-px h-5 bg-border/30" />
                      )}
                      <a
                        href={`tel:${contact.phone}`}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 hover:bg-violet-500/10 transition-colors text-xs text-violet-400"
                        title={`Call ${contact.phone}`}
                      >
                        <Phone className="w-3.5 h-3.5" />
                        Call
                      </a>
                    </>
                  )}
                  {contact.phone && (
                    <>
                      <div className="w-px h-5 bg-border/30" />
                      <a
                        href={`https://wa.me/${contact.phone.replace(/\D/g, "")}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 hover:bg-emerald-500/10 transition-colors text-xs text-emerald-400"
                        title="WhatsApp"
                      >
                        <MessageCircle className="w-3.5 h-3.5" />
                        WhatsApp
                      </a>
                    </>
                  )}
                  {onViewContact && (
                    <>
                      <div className="w-px h-5 bg-border/30" />
                      <button
                        onClick={() => onViewContact(contactId ?? "")}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 hover:bg-[hsl(var(--kf-accent1))]/10 transition-colors text-xs text-[hsl(var(--kf-accent1))]"
                        title="View Contact in CRM"
                      >
                        <User className="w-3.5 h-3.5" />
                        View
                      </button>
                    </>
                  )}
                  {onViewClientIntel && contactId && (
                    <>
                      <div className="w-px h-5 bg-border/30" />
                      <button
                        onClick={() => onViewClientIntel(contactId)}
                        className="flex-1 flex items-center justify-center gap-1.5 py-2.5 hover:bg-purple-500/10 transition-colors text-xs text-purple-400"
                        title="AI Client Intelligence"
                      >
                        <Brain className="w-3.5 h-3.5" />
                        Intel
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}

            {contactId && allInvoices.length > 0 && (() => {
              const cInvs = allInvoices.filter((inv) => inv.contactId === contactId);
              if (cInvs.length === 0) return null;
              const paid = cInvs.filter((i) => i.status === "PAID");
              const overdue = cInvs.filter((i) => i.status === "OVERDUE");
              const sent = cInvs.filter((i) => i.status === "SENT");
              const totalRev = paid.reduce((s, i) => s + Number(i.total ?? 0), 0);
              const outBal = [...overdue, ...sent].reduce((s, i) => s + Number(i.total ?? 0), 0);
              const payRate = cInvs.length > 0 ? Math.round((paid.length / cInvs.length) * 100) : 0;
              let cadence = "Monthly";
              if (overdue.length > 0) cadence = "Weekly";
              else if (outBal > totalRev * 0.3) cadence = "Bi-weekly";
              else if (payRate >= 90) cadence = "Quarterly";
              return (
                <div className="rounded-2xl border border-border/30 bg-white/[0.02] p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5" style={{ color: theme.accentColor }} />
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">Client Intelligence</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-white/[0.03] border border-border/20 p-2">
                      <div className="flex items-center gap-1 mb-0.5">
                        <Shield className="w-2.5 h-2.5 text-muted-foreground/50" />
                        <span className="text-[10px] text-muted-foreground/50">Reliability</span>
                      </div>
                      <span className={`text-sm font-bold ${payRate >= 80 ? "text-emerald-400" : payRate >= 50 ? "text-amber-400" : "text-red-400"}`}>{payRate}%</span>
                    </div>
                    <div className="rounded-lg bg-white/[0.03] border border-border/20 p-2">
                      <div className="flex items-center gap-1 mb-0.5">
                        <DollarSign className="w-2.5 h-2.5 text-muted-foreground/50" />
                        <span className="text-[10px] text-muted-foreground/50">Outstanding</span>
                      </div>
                      <span className={`text-sm font-bold ${outBal > 0 ? "text-amber-400" : "text-emerald-400"}`}>{formatAmount(outBal, currency)}</span>
                    </div>
                    <div className="rounded-lg bg-white/[0.03] border border-border/20 p-2">
                      <div className="flex items-center gap-1 mb-0.5">
                        <TrendingUp className="w-2.5 h-2.5 text-muted-foreground/50" />
                        <span className="text-[10px] text-muted-foreground/50">Lifetime</span>
                      </div>
                      <span className="text-sm font-bold text-emerald-400">{formatAmount(totalRev, currency)}</span>
                    </div>
                    <div className="rounded-lg bg-white/[0.03] border border-border/20 p-2">
                      <div className="flex items-center gap-1 mb-0.5">
                        <Calendar className="w-2.5 h-2.5 text-muted-foreground/50" />
                        <span className="text-[10px] text-muted-foreground/50">Follow-up</span>
                      </div>
                      <span className="text-sm font-bold" style={{ color: theme.accentColor }}>{cadence}</span>
                    </div>
                  </div>
                  {overdue.length > 0 && (
                    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-red-500/5 border border-red-500/15">
                      <AlertTriangle className="w-3 h-3 text-red-400" />
                      <span className="text-[10px] text-red-400 font-medium">{overdue.length} overdue invoice{overdue.length > 1 ? "s" : ""}</span>
                    </div>
                  )}
                </div>
              );
            })()}

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-border/40">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Calendar
                    className="w-3.5 h-3.5"
                    style={{ color: theme.accentColor, opacity: 0.85 }}
                  />
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {dateLabel1}
                  </p>
                </div>
                <p className="text-sm font-semibold">
                  {dateValue1
                    ? new Date(dateValue1).toLocaleDateString("en-TT", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : "—"}
                </p>
              </div>
              <div className="p-3.5 rounded-2xl bg-white/[0.03] border border-border/40">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Calendar
                    className="w-3.5 h-3.5"
                    style={{ color: theme.accentColor, opacity: 0.85 }}
                  />
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {dateLabel2}
                  </p>
                </div>
                <p className="text-sm font-semibold">
                  {dateValue2
                    ? new Date(dateValue2).toLocaleDateString("en-TT", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : "—"}
                </p>
                {dateExtra}
              </div>
            </div>

            {alerts}

            {(onViewClientIntel || onAiDraftReminder) && contactId && (
              <div className="flex items-center gap-2">
                {onViewClientIntel && (
                  <button
                    onClick={() => onViewClientIntel(contactId)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20 transition-colors text-xs font-medium"
                    title="AI Analyze — client payment intelligence"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    AI Analyze
                  </button>
                )}
                {onAiDraftReminder && type === "invoice" && (status === "OVERDUE" || status === "SENT") && (
                  <button
                    onClick={() => onAiDraftReminder(number)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 border border-[hsl(var(--kf-accent1))]/20 transition-colors text-xs font-medium"
                    title="AI Draft Reminder"
                  >
                    <Send className="w-3.5 h-3.5" />
                    AI Draft Reminder
                  </button>
                )}
              </div>
            )}

            {items.length > 0 && (
              <div className="rounded-2xl bg-white/[0.03] border border-border/40 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30">
                  <Package
                    className="w-4 h-4"
                    style={{ color: theme.accentColor, opacity: 0.85 }}
                  />
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Line Items
                  </h4>
                </div>
                <div className="divide-y divide-border/20">
                  {items.map((item, idx) => (
                    <div
                      key={item.id ?? idx}
                      className="px-4 py-3 flex items-start justify-between gap-3 hover:bg-white/[0.02] transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        {item.productId && onSelectProduct ? (
                          <button
                            onClick={() => onSelectProduct(item.productId!)}
                            className="text-sm font-medium truncate text-[hsl(var(--kf-accent1))] hover:underline underline-offset-2 text-left block max-w-full"
                            title="View product details"
                          >
                            {item.description || "Unnamed item"}
                          </button>
                        ) : (
                          <p className="text-sm font-medium truncate">
                            {item.description || "Unnamed item"}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {item.quantity} x{" "}
                          {formatAmount(item.unitPrice ?? 0, currency)}
                        </p>
                      </div>
                      <p className="text-sm font-semibold shrink-0">
                        {formatAmount(item.total ?? 0, currency)}
                      </p>
                    </div>
                  ))}
                </div>

                <div className="border-t border-border/30 px-4 py-3 space-y-2 bg-white/[0.02]">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>Subtotal</span>
                    <span>{formatAmount(subtotal, currency)}</span>
                  </div>
                  {(taxRate || 0) > 0 && (
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">Tax ({taxRate}%) <InfoBadge title="Tax Calculation" body="Tax is applied to the subtotal after any discounts. The rate is set per invoice or in Settings > Payments. Trinidad default: 12.5% VAT." side="left" iconSize={10} /></span>
                      <span>{formatAmount(taxAmount, currency)}</span>
                    </div>
                  )}
                  {discountAmount > 0 && (
                    <div className="flex justify-between text-xs text-emerald-400">
                      <span>
                        Discount{" "}
                        {discountType === "PERCENT"
                          ? `(${discountValue}%)`
                          : ""}
                      </span>
                      <span>-{formatAmount(discountAmount, currency)}</span>
                    </div>
                  )}
                  <div
                    className="flex justify-between items-center pt-2 border-t border-border/30"
                  >
                    <span className="text-sm font-bold">Total</span>
                    <span
                      className="text-lg font-extrabold"
                      style={{ color: theme.accentColor }}
                    >
                      {formatAmount(total, currency)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {notes && (
              <div className="rounded-2xl bg-white/[0.03] border border-border/40 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border/30">
                  <StickyNote
                    className="w-4 h-4"
                    style={{ color: theme.accentColor, opacity: 0.85 }}
                  />
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Notes
                  </h4>
                </div>
                <div className="px-4 py-3">
                  <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                    {notes}
                  </p>
                </div>
              </div>
            )}

            {businessData && (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowTemplatePreview(true)}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl border border-border/40 bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-sm font-medium text-foreground/80 hover:text-foreground"
                >
                  <Eye className="w-4 h-4" style={{ color: theme.accentColor }} />
                  View as Customer
                </button>
                <button
                  onClick={handlePrint}
                  className="flex items-center justify-center gap-2 px-5 py-3 rounded-2xl border border-border/40 bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-sm font-medium text-foreground/80 hover:text-foreground"
                  title="Print / Save as PDF"
                >
                  <Printer className="w-4 h-4" style={{ color: theme.accentColor }} />
                  Print
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border/40 bg-card/80 backdrop-blur-sm px-4 py-3 space-y-2">
          {actions}
        </div>
      </motion.div>

      <motion.div
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 26, stiffness: 300 }}
        role="dialog"
        aria-modal="true"
        aria-label={`${theme.label} ${number}`}
        drag="y"
        dragConstraints={{ top: 0, bottom: 200 }}
        dragElastic={{ top: 0, bottom: 0.6 }}
        onDragEnd={(_: any, info: { offset: { y: number }; velocity: { y: number } }) => {
          if (info.offset.y > 100 || info.velocity.y > 500) onClose();
        }}
        className="absolute bottom-0 left-0 right-0 max-h-[92vh] bg-card rounded-t-3xl border-t border-border/60 shadow-2xl flex flex-col sm:hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="w-full flex items-center justify-center py-3 cursor-pointer active:bg-muted/30 transition-colors shrink-0"
          aria-label="Close panel"
        >
          <div className="w-10 h-1 bg-muted-foreground/40 rounded-full" />
        </button>

        <div
          className="px-5 pb-4 border-b border-border/40 shrink-0"
          style={{
            background: `linear-gradient(135deg, ${theme.accentColor}10 0%, transparent 60%)`,
          }}
        >
          <div className="flex items-center gap-3 mb-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{
                backgroundColor: `${theme.accentColor}18`,
                border: `1px solid ${theme.accentColor}30`,
              }}
            >
              <FileText
                className="w-5 h-5"
                style={{ color: theme.accentColor }}
              />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold truncate">
                  {theme.label} #{number}
                </h2>
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none shrink-0 ${getStatusBadge(status)}`}
                >
                  {status}
                </span>
              </div>
            </div>
          </div>
          <p
            className="text-2xl font-extrabold tracking-tight"
            style={{ color: theme.accentColor }}
          >
            {formatAmount(total, currency)}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain">
          <div className="p-5 space-y-4">
            {contact && contactName && (
              <div className="flex items-center gap-3 p-3 rounded-2xl bg-white/[0.03] border border-border/40">
                <div
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ backgroundColor: theme.avatarBg }}
                >
                  <span className={theme.avatarText}>
                    {getContactInitials(contact)}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate">
                    {contactName}
                  </p>
                  {contact.email && (
                    <p className="text-xs text-muted-foreground truncate">
                      {contact.email}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {contact.email && (
                    <a
                      href={`mailto:${contact.email}`}
                      className="p-2 rounded-lg hover:bg-blue-500/10 transition-colors"
                    >
                      <Mail className="w-4 h-4 text-blue-400" />
                    </a>
                  )}
                  {contact.phone && (
                    <a
                      href={`tel:${contact.phone}`}
                      className="p-2 rounded-lg hover:bg-violet-500/10 transition-colors"
                    >
                      <Phone className="w-4 h-4 text-violet-400" />
                    </a>
                  )}
                  {onViewContact && (
                    <button
                      onClick={() => onViewContact(contactId ?? "")}
                      className="p-2 rounded-lg hover:bg-[hsl(var(--kf-accent1))]/10 transition-colors"
                      title="View Contact"
                    >
                      <User className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                    </button>
                  )}
                  {onViewClientIntel && contactId && (
                    <button
                      onClick={() => onViewClientIntel(contactId)}
                      className="p-2 rounded-lg hover:bg-purple-500/10 transition-colors"
                      title="AI Client Intel"
                    >
                      <Brain className="w-4 h-4 text-purple-400" />
                    </button>
                  )}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-2xl bg-white/[0.03] border border-border/40">
                <div className="flex items-center gap-1.5 mb-1">
                  <Calendar
                    className="w-3.5 h-3.5"
                    style={{ color: theme.accentColor, opacity: 0.85 }}
                  />
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {dateLabel1}
                  </p>
                </div>
                <p className="text-sm font-semibold">
                  {dateValue1
                    ? new Date(dateValue1).toLocaleDateString("en-TT", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : "—"}
                </p>
              </div>
              <div className="p-3 rounded-2xl bg-white/[0.03] border border-border/40">
                <div className="flex items-center gap-1.5 mb-1">
                  <Calendar
                    className="w-3.5 h-3.5"
                    style={{ color: theme.accentColor, opacity: 0.85 }}
                  />
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {dateLabel2}
                  </p>
                </div>
                <p className="text-sm font-semibold">
                  {dateValue2
                    ? new Date(dateValue2).toLocaleDateString("en-TT", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })
                    : "—"}
                </p>
                {dateExtra}
              </div>
            </div>

            {alerts}

            {(onViewClientIntel || onAiDraftReminder) && contactId && (
              <div className="flex items-center gap-2">
                {onViewClientIntel && (
                  <button
                    onClick={() => onViewClientIntel(contactId)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20 transition-colors text-xs font-medium"
                    title="AI Analyze — client payment intelligence"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    AI Analyze
                  </button>
                )}
                {onAiDraftReminder && type === "invoice" && (status === "OVERDUE" || status === "SENT") && (
                  <button
                    onClick={() => onAiDraftReminder(number)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] hover:bg-[hsl(var(--kf-accent1))]/20 border border-[hsl(var(--kf-accent1))]/20 transition-colors text-xs font-medium"
                    title="AI Draft Reminder"
                  >
                    <Send className="w-3.5 h-3.5" />
                    AI Draft Reminder
                  </button>
                )}
              </div>
            )}

            {items.length > 0 && (
              <div className="rounded-2xl bg-white/[0.03] border border-border/40 overflow-hidden">
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/30">
                  <Package
                    className="w-3.5 h-3.5"
                    style={{ color: theme.accentColor, opacity: 0.85 }}
                  />
                  <h4 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Line Items
                  </h4>
                </div>
                <div className="divide-y divide-border/20">
                  {items.map((item, idx) => (
                    <div
                      key={item.id ?? idx}
                      className="px-4 py-2.5 flex items-center justify-between gap-2"
                    >
                      <div className="flex-1 min-w-0">
                        {item.productId && onSelectProduct ? (
                          <button
                            onClick={() => onSelectProduct(item.productId!)}
                            className="text-sm font-medium truncate text-[hsl(var(--kf-accent1))] hover:underline underline-offset-2 text-left block max-w-full"
                            title="View product details"
                          >
                            {item.description || "Unnamed item"}
                          </button>
                        ) : (
                          <p className="text-sm font-medium truncate">
                            {item.description || "Unnamed item"}
                          </p>
                        )}
                        <p className="text-[10px] text-muted-foreground">
                          {item.quantity} x{" "}
                          {formatAmount(item.unitPrice ?? 0, currency)}
                        </p>
                      </div>
                      <p className="text-sm font-semibold shrink-0">
                        {formatAmount(item.total ?? 0, currency)}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="border-t border-border/30 px-4 py-2.5 bg-white/[0.02]">
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-bold">Total</span>
                    <span
                      className="text-base font-extrabold"
                      style={{ color: theme.accentColor }}
                    >
                      {formatAmount(total, currency)}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {notes && (
              <div className="p-3 rounded-2xl bg-white/[0.03] border border-border/40">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <StickyNote
                    className="w-3.5 h-3.5"
                    style={{ color: theme.accentColor, opacity: 0.85 }}
                  />
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Notes
                  </p>
                </div>
                <p className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
                  {notes}
                </p>
              </div>
            )}

            {businessData && (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowTemplatePreview(true)}
                  className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl border border-border/40 bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-sm font-medium text-foreground/80 hover:text-foreground"
                >
                  <Eye className="w-4 h-4" style={{ color: theme.accentColor }} />
                  Preview
                </button>
                <button
                  onClick={handlePrint}
                  className="flex items-center justify-center gap-2 px-4 py-3 rounded-2xl border border-border/40 bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-sm font-medium text-foreground/80 hover:text-foreground"
                  title="Print / Save as PDF"
                >
                  <Printer className="w-4 h-4" style={{ color: theme.accentColor }} />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="border-t border-border/40 bg-card/80 backdrop-blur-sm p-4 space-y-2 shrink-0">
          {actions}
        </div>
      </motion.div>

      {templateData && (
        <div
          ref={printTemplateRef}
          aria-hidden="true"
          style={{ position: "absolute", left: "-9999px", top: 0, width: "794px", pointerEvents: "none" }}
        >
          <InvoiceTemplateRenderer templateId={templateId} data={templateData} />
        </div>
      )}

      {businessData && showTemplatePreview && (
        <TemplateCustomizer
          open={showTemplatePreview}
          onClose={() => setShowTemplatePreview(false)}
          activeTemplate={(businessData.invoiceTemplate as TemplateId) || "classic"}
          onSaveBranding={onSaveBranding}
          savingBranding={savingBranding}
          data={{
            type: type === "invoice" ? "invoice" : "quote",
            number: number,
            status: status,
            issueDate: dateValue1,
            dueDate: type === "invoice" ? dateValue2 : null,
            expiryDate: type === "quote" ? dateValue2 : null,
            contact: contact,
            items: items,
            subtotal: subtotal,
            taxRate: taxRate || 0,
            taxAmount: taxAmount,
            discountType: discountType,
            discountValue: discountValue ? Number(discountValue) : null,
            discountAmount: discountAmount,
            total: total,
            currency: currency,
            notes: notes,
            business: {
              name: businessData.name,
              logoUrl: businessData.logoUrl || null,
              address: businessData.address,
              city: businessData.city,
              country: businessData.country,
              phone: businessData.phone,
              email: businessData.email,
              website: businessData.website,
              tagline: businessData.tagline,
              primaryColor: businessData.primaryColor,
              secondaryColor: businessData.secondaryColor,
            },
          }}
        />
      )}
    </motion.div>
  );
}
