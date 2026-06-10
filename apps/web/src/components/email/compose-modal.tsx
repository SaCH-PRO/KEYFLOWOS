"use client";

import { useEffect, useState, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Loader2,
  X,
  Sparkles,
  Wand2,
  Eye,
  EyeOff,
  Mail,
  PenTool,
  MessageSquare,
  Briefcase,
  HeartHandshake,
  PartyPopper,
  AlertCircle,
  User,
  Search,
  FileText,
  Flame,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { SideSheet } from "@/components/ui/side-sheet";
import { EmailEditor } from "@/app/app/marketing/components/email-editor";
import { apiPostSimple } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchContacts, aiGenerateDraft, aiRewriteContent, aiSuggestSubjects } from "@/lib/client";
import type { ContactListResponse } from "@/lib/client";

export interface ComposePrefill {
  to?: string | string[];
  toContacts?: { id?: string; email: string; name?: string }[];
  subject?: string;
  body?: string;
  threadId?: string;
  inReplyTo?: string;
  context?: {
    type?: "invoice" | "quote" | "general" | "follow_up" | "introduction" | "thank_you";
    recordNumber?: string;
    amount?: string;
    currency?: string;
    dueDate?: string;
    contactName?: string;
    businessName?: string;
  };
  aiPrompt?: string;
}

interface ComposeModalProps {
  open: boolean;
  onClose: () => void;
  prefill?: ComposePrefill;
  onSent?: () => void;
}

interface EmailTemplate {
  key: string;
  label: string;
  icon: React.ElementType;
  category: string;
  description: string;
  subject: string;
  body: string;
}

const TEMPLATES: EmailTemplate[] = [
  {
    key: "follow_up",
    label: "Gentle Follow-up",
    icon: MessageSquare,
    category: "Sales",
    description: "Polite nudge for unanswered outreach",
    subject: "Quick follow-up",
    body: `<p>Hi {{name}},</p><p>I wanted to follow up on my previous message. I know things get busy, so I&apos;m happy to work around your schedule.</p><p>Let me know if you have any questions or if there&apos;s a better time to connect.</p><p>Best,<br>{{sender}}</p>`,
  },
  {
    key: "invoice_send",
    label: "Send Invoice",
    icon: FileText,
    category: "Billing",
    description: "Professional invoice delivery",
    subject: "Invoice {{recordNumber}} from {{businessName}}",
    body: `<p>Hi {{name}},</p><p>Thank you for your business. Please find invoice <strong>{{recordNumber}}</strong> attached.</p><p><strong>Amount due:</strong> {{currency}}{{amount}}<br><strong>Due date:</strong> {{dueDate}}</p><p>If you have any questions, just reply to this email.</p><p>Best,<br>{{sender}}</p>`,
  },
  {
    key: "quote_send",
    label: "Send Quote",
    icon: Briefcase,
    category: "Sales",
    description: "Quote proposal with next steps",
    subject: "Your quote {{recordNumber}} from {{businessName}}",
    body: `<p>Hi {{name}},</p><p>Thank you for considering us. Please find your quote <strong>{{recordNumber}}</strong> attached.</p><p>If everything looks good, you can approve directly via the link in the document. I&apos;m here to answer any questions.</p><p>Best,<br>{{sender}}</p>`,
  },
  {
    key: "thank_you",
    label: "Thank You",
    icon: HeartHandshake,
    category: "Relationship",
    description: "Warm appreciation note",
    subject: "Thank you",
    body: `<p>Hi {{name}},</p><p>I just wanted to take a moment to say thank you. We truly appreciate your trust and partnership.</p><p>Looking forward to continuing to work together.</p><p>Warmly,<br>{{sender}}</p>`,
  },
  {
    key: "introduction",
    label: "Introduction",
    icon: User,
    category: "Networking",
    description: "First-touch outreach",
    subject: "Introduction — {{businessName}}",
    body: `<p>Hi {{name}},</p><p>My name is {{sender}} and I lead {{businessName}}. I came across your work and wanted to reach out.</p><p>I&apos;d love to learn more about what you&apos;re building and explore how we might be able to support you.</p><p>Would you be open to a brief call next week?</p><p>Best,<br>{{sender}}</p>`,
  },
  {
    key: "reminder",
    label: "Payment Reminder",
    icon: AlertCircle,
    category: "Billing",
    description: "Friendly overdue notice",
    subject: "Friendly reminder: invoice {{recordNumber}}",
    body: `<p>Hi {{name}},</p><p>This is a friendly reminder that invoice <strong>{{recordNumber}}</strong> for <strong>{{currency}}{{amount}}</strong> was due on <strong>{{dueDate}}</strong>.</p><p>If payment has already been sent, please disregard this message. Otherwise, let me know if you need anything from me.</p><p>Best,<br>{{sender}}</p>`,
  },
  {
    key: "celebration",
    label: "Milestone",
    icon: PartyPopper,
    category: "Relationship",
    description: "Celebrate wins together",
    subject: "Great news to share",
    body: `<p>Hi {{name}},</p><p>I wanted to share some exciting news with you — we recently hit a milestone, and we couldn&apos;t have done it without partners like you.</p><p>Thank you for being part of the journey.</p><p>Cheers,<br>{{sender}}</p>`,
  },
];

const TONES = [
  { key: "professional", label: "Professional", desc: "Clear and business-appropriate" },
  { key: "warm", label: "Warm", desc: "Friendly and personable" },
  { key: "concise", label: "Concise", desc: "Short and direct" },
  { key: "persuasive", label: "Persuasive", desc: "Compelling and action-oriented" },
  { key: "empathetic", label: "Empathetic", desc: "Understanding and supportive" },
];

function applyTemplate(template: EmailTemplate, context?: ComposePrefill["context"]) {
  let subject = template.subject;
  let body = template.body;
  const vars: Record<string, string> = {
    name: context?.contactName?.trim() || "there",
    sender: context?.businessName?.trim() || "Team",
    businessName: context?.businessName?.trim() || "us",
    recordNumber: context?.recordNumber || "",
    amount: context?.amount || "",
    currency: context?.currency || "$",
    dueDate: context?.dueDate || "",
  };
  Object.entries(vars).forEach(([key, value]) => {
    subject = subject.replace(new RegExp(`{{${key}}}`, "g"), value);
    body = body.replace(new RegExp(`{{${key}}}`, "g"), value);
  });
  return { subject, body };
}

export function ComposeModal({ open, onClose, prefill, onSent }: ComposeModalProps) {
  const [toEmails, setToEmails] = useState<string[]>([]);
  const [toInput, setToInput] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [activeAiTab, setActiveAiTab] = useState<"templates" | "ai" | "tones">("templates");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [subjectSuggestions, setSubjectSuggestions] = useState<string[]>([]);
  const [subjectLoading, setSubjectLoading] = useState(false);
  const [contacts, setContacts] = useState<ContactListResponse["contacts"]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const toInputRef = useRef<HTMLInputElement>(null);
  const businessId = getStoredBusinessId();

  const isReply = Boolean(prefill?.threadId && prefill?.inReplyTo);

  useEffect(() => {
    if (!open) return;
    const initialTo: string[] = [];
    if (prefill?.to) {
      if (Array.isArray(prefill.to)) initialTo.push(...prefill.to.filter(Boolean));
      else initialTo.push(prefill.to);
    }
    if (prefill?.toContacts) {
      prefill.toContacts.forEach((c) => {
        if (c.email && !initialTo.includes(c.email)) initialTo.push(c.email);
      });
    }
    const initialSubject = prefill?.subject ?? "";
    let initialBody = prefill?.body ?? "";
    // Auto-apply template for invoice/quote sends when body is empty
    if (!initialBody.trim() && prefill?.context?.type) {
      const autoTemplate =
        prefill.context.type === "invoice"
          ? TEMPLATES.find((t) => t.key === "invoice_send")
          : prefill.context.type === "quote"
            ? TEMPLATES.find((t) => t.key === "quote_send")
            : undefined;
      if (autoTemplate) {
        const applied = applyTemplate(autoTemplate, prefill.context);
        initialBody = applied.body;
      }
    }
    setToEmails(initialTo);
    setSubject(initialSubject);
    setBody(initialBody);
    setAiPrompt(prefill?.aiPrompt ?? "");
    setShowPreview(false);
    setActiveAiTab("templates");
    setSubjectSuggestions([]);
  }, [open, prefill]);

  useEffect(() => {
    if (!open || !businessId) return;
    let cancelled = false;
    setContactsLoading(true);
    fetchContacts(businessId, { take: 50 })
      .then((res) => {
        if (!cancelled && res.data?.contacts) setContacts(res.data.contacts);
      })
      .finally(() => setContactsLoading(false));
    return () => { cancelled = true; };
  }, [open, businessId]);

  const filteredContacts = useMemo(() => {
    const q = toInput.trim().toLowerCase();
    if (!q) return contacts.slice(0, 6);
    return contacts
      .filter(
        (c) =>
          c.email?.toLowerCase().includes(q) ||
          c.displayName?.toLowerCase().includes(q) ||
          `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim().toLowerCase().includes(q)
      )
      .slice(0, 6);
  }, [contacts, toInput]);

  const handleAddEmail = (email: string) => {
    const clean = email.trim().toLowerCase();
    if (!clean) return;
    if (!toEmails.includes(clean)) {
      setToEmails((prev) => [...prev, clean]);
    }
    setToInput("");
    toInputRef.current?.focus();
  };

  const handleRemoveEmail = (email: string) => {
    setToEmails((prev) => prev.filter((e) => e !== email));
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      handleAddEmail(toInput);
    }
    if (e.key === "Backspace" && !toInput && toEmails.length > 0) {
      setToEmails((prev) => prev.slice(0, -1));
    }
  };

  const handleSend = async () => {
    if (!businessId) {
      toast.error("No business selected");
      return;
    }
    if (toEmails.length === 0) {
      toast.error("Add at least one recipient");
      return;
    }
    if (!subject.trim()) {
      toast.error("Subject is required");
      return;
    }
    if (!body.trim() || body === "<p></p>") {
      toast.error("Message body is empty");
      return;
    }

    setSending(true);
    try {
      for (const recipient of toEmails) {
        const path = isReply
          ? `/commerce/businesses/${businessId}/gmail/threads/${prefill!.threadId}/reply`
          : `/commerce/businesses/${businessId}/gmail/messages/send`;
        const payload = isReply
          ? { inReplyTo: prefill!.inReplyTo, to: recipient, subject, htmlBody: body }
          : { to: recipient, subject, htmlBody: body };
        const res = await apiPostSimple<{ messageId: string }>(path, payload);
        if (res.error) {
          toast.error(res.error);
          setSending(false);
          return;
        }
      }
      toast.success(isReply ? "Reply sent" : `Email sent to ${toEmails.length} recipient${toEmails.length === 1 ? "" : "s"}`);
      onSent?.();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  };

  const applyTemplateAndClose = (template: EmailTemplate) => {
    const ctx = prefill?.context;
    const { subject: s, body: b } = applyTemplate(template, ctx);
    setSubject(s);
    setBody(b);
    toast.success(`Applied "${template.label}" template`);
  };

  const generateWithAi = async () => {
    if (!businessId) return;
    if (!aiPrompt.trim() && !subject && !body) {
      toast.error("Describe what you want to say");
      return;
    }
    setAiLoading(true);
    try {
      const prompt = aiPrompt.trim() || prefill?.aiPrompt || `Write an email about: ${subject || "general update"}`;
      const res = await aiGenerateDraft(
        {
          contentType: "email",
          objective: prefill?.context?.type || "general",
          tone: "professional",
          audience: prefill?.context?.contactName ? `contact: ${prefill.context.contactName}` : undefined,
          topic: prompt,
          existingBody: body || undefined,
        },
        businessId
      );
      if (res.data?.body) {
        setBody(res.data.body);
        if (res.data.subject && !subject) setSubject(res.data.subject);
        toast.success("AI draft generated");
      } else {
        toast.error("AI could not generate a draft");
      }
    } catch {
      toast.error("AI generation failed");
    } finally {
      setAiLoading(false);
    }
  };

  const rewriteWithTone = async (tone: string) => {
    if (!businessId || !body.trim() || body === "<p></p>") {
      toast.error("Write something first");
      return;
    }
    setAiLoading(true);
    try {
      const res = await aiRewriteContent(
        { body, targetChannel: "email", tone, objective: prefill?.context?.type || "general" },
        businessId
      );
      if (res.data?.body) {
        setBody(res.data.body);
        toast.success(`Rewritten in ${tone} tone`);
      }
    } catch {
      toast.error("Rewrite failed");
    } finally {
      setAiLoading(false);
    }
  };

  const suggestSubjects = async () => {
    if (!businessId || !body.trim() || body === "<p></p>") {
      toast.error("Write the body first");
      return;
    }
    setSubjectLoading(true);
    try {
      const res = await aiSuggestSubjects(
        { body, objective: prefill?.context?.type || "general", tone: "professional" },
        businessId
      );
      if (res.data?.subjects?.length) {
        setSubjectSuggestions(res.data.subjects.slice(0, 4));
      }
    } catch {
      toast.error("Could not suggest subjects");
    } finally {
      setSubjectLoading(false);
    }
  };

  const categories = useMemo(() => Array.from(new Set(TEMPLATES.map((t) => t.category))), []);

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[hsl(var(--kf-accent1))]/20 to-[hsl(var(--kf-accent2))]/20 flex items-center justify-center">
            <Mail className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
          </div>
          <div>
            <div className="text-sm font-semibold">{isReply ? "Reply" : "Compose email"}</div>
            <div className="text-[11px] text-muted-foreground">Premium KEYFLOWOS email composer</div>
          </div>
        </div>
      }
      width="2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowPreview((p) => !p)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            >
              {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showPreview ? "Edit" : "Preview"}
            </button>
            <button
              type="button"
              onClick={() => setActiveAiTab("templates")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Templates
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={sending}
              className="px-4 py-2 text-xs font-medium rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || toEmails.length === 0 || !subject.trim()}
              className="flex items-center gap-2 px-4 py-2 text-xs font-medium rounded-lg disabled:opacity-50 transition-colors"
              style={{
                background: "hsl(var(--kf-accent1))",
                color: "hsl(var(--kf-primary-foreground))",
              }}
            >
              {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
              {sending ? "Sending…" : isReply ? "Send reply" : "Send email"}
            </button>
          </div>
        </div>
      }
    >
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 h-full">
        {/* Main composer */}
        <div className="lg:col-span-2 space-y-4">
          {/* Recipients */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">To</label>
            <div
              className="min-h-[44px] px-2 py-1.5 rounded-xl border border-border/40 bg-muted/20 flex flex-wrap items-center gap-1.5 focus-within:border-[hsl(var(--kf-accent1))]/40 focus-within:ring-1 focus-within:ring-[hsl(var(--kf-accent1))]/10 transition-all"
              onClick={() => toInputRef.current?.focus()}
            >
              {toEmails.map((email) => (
                <span
                  key={email}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[hsl(var(--kf-accent1))]/10 text-[hsl(var(--kf-accent1))] text-xs font-medium"
                >
                  {email}
                  {!isReply && (
                    <button onClick={() => handleRemoveEmail(email)} className="hover:opacity-70">
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </span>
              ))}
              {!isReply && (
                <input
                  ref={toInputRef}
                  type="text"
                  value={toInput}
                  onChange={(e) => {
                    setToInput(e.target.value);
                    setShowContacts(true);
                  }}
                  onKeyDown={handleKeyDown}
                  onBlur={() => setTimeout(() => setShowContacts(false), 150)}
                  onFocus={() => setShowContacts(true)}
                  placeholder={toEmails.length === 0 ? "Type email or search contacts…" : ""}
                  className="flex-1 min-w-[120px] bg-transparent text-sm outline-none placeholder:text-muted-foreground/60 py-1"
                />
              )}
            </div>
            <AnimatePresence>
              {showContacts && !isReply && (toInput.trim() || contacts.length > 0) && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="rounded-xl border border-border/40 bg-card shadow-xl overflow-hidden"
                >
                  <div className="px-3 py-2 border-b border-border/20 bg-muted/20 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Search className="w-3 h-3" />
                    {contactsLoading ? "Loading contacts…" : toInput.trim() ? "Matching contacts" : "Suggested contacts"}
                  </div>
                  <div className="max-h-[200px] overflow-y-auto">
                    {filteredContacts.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        {toInput.trim() ? `Press Enter to add "${toInput}"` : "No contacts found"}
                      </div>
                    ) : (
                      filteredContacts.map((contact) => (
                        <button
                          key={contact.id}
                          type="button"
                          onClick={() => contact.email && handleAddEmail(contact.email)}
                          className="w-full px-3 py-2 flex items-center gap-2 hover:bg-muted/30 transition-colors text-left"
                        >
                          <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-medium shrink-0">
                            {(contact.displayName?.[0] || contact.firstName?.[0] || contact.lastName?.[0] || contact.email?.[0] || "?").toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-medium truncate">{contact.displayName || `${contact.firstName ?? ""} ${contact.lastName ?? ""}`.trim() || contact.email}</div>
                            <div className="text-[10px] text-muted-foreground truncate">{contact.email}</div>
                          </div>
                          {contact.email && toEmails.includes(contact.email) && (
                            <Check className="w-3.5 h-3.5 text-emerald-500 ml-auto" />
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Subject */}
          <div className="space-y-1.5 relative">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Subject</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="What's this email about?"
                className="flex-1 px-3 py-2.5 rounded-xl bg-muted/20 border border-border/40 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]/40 transition-colors"
              />
              <button
                type="button"
                onClick={suggestSubjects}
                disabled={subjectLoading || !body.trim() || body === "<p></p>"}
                className="px-3 py-2 rounded-xl border border-border/40 text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors disabled:opacity-50 text-xs font-medium whitespace-nowrap"
              >
                {subjectLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                <span className="hidden sm:inline ml-1.5">Suggest</span>
              </button>
            </div>
            <AnimatePresence>
              {subjectSuggestions.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  className="flex flex-wrap gap-2"
                >
                  {subjectSuggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => {
                        setSubject(s);
                        setSubjectSuggestions([]);
                      }}
                      className="text-xs px-2.5 py-1 rounded-lg border border-[hsl(var(--kf-accent2))]/30 bg-[hsl(var(--kf-accent2))]/5 text-[hsl(var(--kf-accent2))] hover:bg-[hsl(var(--kf-accent2))]/10 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                  <button
                    onClick={() => setSubjectSuggestions([])}
                    className="text-xs px-2 py-1 rounded-lg text-muted-foreground hover:text-foreground"
                  >
                    Dismiss
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Body */}
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">Message</label>
            {showPreview ? (
              <div className="min-h-[260px] rounded-xl border border-border/40 bg-white text-slate-900 p-5 prose prose-sm max-w-none">
                <div dangerouslySetInnerHTML={{ __html: body }} />
              </div>
            ) : (
              <div className="rounded-xl border border-border/40 overflow-hidden bg-muted/20">
                <EmailEditor value={body} onChange={setBody} placeholder="Write your message…" />
              </div>
            )}
          </div>
        </div>

        {/* AI / Templates Sidebar */}
        <div className="lg:col-span-1">
          <div className="rounded-xl border border-border/40 bg-card/40 backdrop-blur-sm overflow-hidden h-full flex flex-col">
            {/* Tabs */}
            <div className="flex items-center border-b border-border/30">
              {[
                { key: "templates", label: "Templates", icon: FileText },
                { key: "ai", label: "AI", icon: Sparkles },
                { key: "tones", label: "Tone", icon: PenTool },
              ].map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveAiTab(t.key as typeof activeAiTab)}
                  className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-[11px] font-medium transition-colors ${
                    activeAiTab === t.key
                      ? "text-foreground border-b-2 border-[hsl(var(--kf-accent1))] bg-muted/20"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/10"
                  }`}
                >
                  <t.icon className="w-3.5 h-3.5" />
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 p-3 overflow-y-auto">
              {activeAiTab === "templates" && (
                <div className="space-y-4">
                  {categories.map((category) => (
                    <div key={category}>
                      <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">{category}</p>
                      <div className="space-y-1.5">
                        {TEMPLATES.filter((t) => t.category === category).map((template) => (
                          <button
                            key={template.key}
                            onClick={() => applyTemplateAndClose(template)}
                            className="w-full text-left p-2.5 rounded-lg border border-border/30 bg-card/30 hover:border-[hsl(var(--kf-accent1))]/30 hover:bg-card/60 transition-all group"
                          >
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-md bg-muted/50 flex items-center justify-center group-hover:bg-[hsl(var(--kf-accent1))]/10 transition-colors">
                                <template.icon className="w-3.5 h-3.5 text-muted-foreground group-hover:text-[hsl(var(--kf-accent1))]" />
                              </div>
                              <div className="min-w-0">
                                <div className="text-xs font-medium">{template.label}</div>
                                <div className="text-[10px] text-muted-foreground">{template.description}</div>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeAiTab === "ai" && (
                <div className="space-y-3">
                  <div className="p-3 rounded-lg bg-gradient-to-br from-[hsl(var(--kf-accent1))]/10 to-[hsl(var(--kf-accent2))]/10 border border-[hsl(var(--kf-accent1))]/20">
                    <div className="flex items-center gap-2 mb-2">
                      <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
                      <span className="text-xs font-semibold">KEY AI Composer</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mb-3">
                      Describe what you want to say and KEY will write a polished draft.
                    </p>
                    <textarea
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      placeholder="e.g. Follow up with Sarah about the overdue invoice and offer a payment plan"
                      rows={3}
                      className="w-full px-3 py-2 rounded-lg bg-background/60 border border-border/40 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]/40 resize-none"
                    />
                    <button
                      onClick={generateWithAi}
                      disabled={aiLoading || !aiPrompt.trim()}
                      className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white disabled:opacity-50 transition-colors"
                      style={{ background: "hsl(var(--kf-accent1))" }}
                    >
                      {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                      {aiLoading ? "Writing…" : "Generate draft"}
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Quick actions</p>
                    {[
                      { label: "Make shorter", icon: MessageSquare, action: () => rewriteWithTone("concise") },
                      { label: "Make more professional", icon: Briefcase, action: () => rewriteWithTone("professional") },
                      { label: "Make warmer", icon: HeartHandshake, action: () => rewriteWithTone("warm") },
                      { label: "Add urgency", icon: Flame, action: () => rewriteWithTone("persuasive") },
                    ].map((item) => (
                      <button
                        key={item.label}
                        onClick={item.action}
                        disabled={aiLoading || !body.trim() || body === "<p></p>"}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-border/30 bg-card/30 hover:bg-card/60 transition-colors text-left disabled:opacity-50"
                      >
                        <item.icon className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-xs">{item.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {activeAiTab === "tones" && (
                <div className="space-y-3">
                  <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Rewrite tone</p>
                  {TONES.map((tone) => (
                    <button
                      key={tone.key}
                      onClick={() => rewriteWithTone(tone.key)}
                      disabled={aiLoading || !body.trim() || body === "<p></p>"}
                      className="w-full text-left p-3 rounded-lg border border-border/30 bg-card/30 hover:border-[hsl(var(--kf-accent1))]/30 hover:bg-card/60 transition-all disabled:opacity-50 group"
                    >
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="text-xs font-medium">{tone.label}</span>
                        <Wand2 className="w-3 h-3 text-muted-foreground group-hover:text-[hsl(var(--kf-accent1))]" />
                      </div>
                      <p className="text-[10px] text-muted-foreground">{tone.desc}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </SideSheet>
  );
}
