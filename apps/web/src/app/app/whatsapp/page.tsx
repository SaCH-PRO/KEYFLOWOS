"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MessageCircle, Send, Plus, Loader2, Calendar, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button, Badge } from "@keyflow/ui";
import { WorkspaceShell } from "@/components/ui/workspace-shell";
import { apiGet, apiPostSimple } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

interface ConversationItem {
  id: string;
  phoneNumber: string;
  displayName: string;
  contactId: string | null;
  lastMessageAt: string | null;
  lastMessageSnippet: string | null;
}

interface ConversationMessage {
  id: string;
  direction: "INBOUND" | "OUTBOUND";
  body: string | null;
  templateName: string | null;
  status: string;
  scheduledAt: string | null;
  sentAt: string | null;
  createdAt: string;
  errorMessage: string | null;
}

interface ConversationDetail {
  id: string;
  phoneNumber: string;
  displayName: string;
  contactId: string | null;
  withinWindow: boolean;
  messages: ConversationMessage[];
}

interface WhatsAppTemplate {
  name: string;
  language: string;
  category?: string;
  variableCount: number;
}

interface CrmContact {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  phone?: string | null;
  whatsappNumber?: string | null;
}

interface ConnectionStatus {
  connected: boolean;
  destination?: { id: string; platformId: string; displayName: string | null };
}

function formatTime(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function WhatsAppInboxPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationDetail | null>(null);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [composer, setComposer] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("");
  const [templateParams, setTemplateParams] = useState<string[]>([]);
  const [scheduleAt, setScheduleAt] = useState<string>("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [crmContacts, setCrmContacts] = useState<CrmContact[]>([]);
  const [newPhone, setNewPhone] = useState("");
  const [newContactId, setNewContactId] = useState<string>("");

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only storage hydration on mount
    setBusinessId(getStoredBusinessId());
  }, []);

  const loadAll = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    const [s, c, t] = await Promise.all([
      apiGet<ConnectionStatus>(`/whatsapp/businesses/${businessId}/status`),
      apiGet<ConversationItem[]>(`/whatsapp/businesses/${businessId}/conversations`),
      apiGet<{ templates: WhatsAppTemplate[]; error?: string }>(`/whatsapp/businesses/${businessId}/templates`),
    ]);
    setStatus(s.data ?? { connected: false });
    setConversations(c.data ?? []);
    setTemplates(t.data?.templates ?? []);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async hydration via loadAll() callback
    void loadAll();
  }, [loadAll]);

  const loadConversation = useCallback(async (id: string) => {
    if (!businessId) return;
    const r = await apiGet<ConversationDetail>(`/whatsapp/businesses/${businessId}/conversations/${id}`);
    setConversation(r.data ?? null);
  }, [businessId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async hydration when active conversation changes
    if (activeId) void loadConversation(activeId);
  }, [activeId, loadConversation]);

  const loadCrmContacts = useCallback(async () => {
    if (!businessId) return;
    const r = await apiGet<{ contacts?: CrmContact[] } | CrmContact[]>(`/crm/businesses/${businessId}/contacts?limit=200`);
    const list = Array.isArray(r.data) ? r.data : (r.data?.contacts ?? []);
    setCrmContacts(list.filter((c) => !!(c.phone || c.whatsappNumber)));
  }, [businessId]);

  const tpl = useMemo(() => templates.find((t) => t.name === selectedTemplate), [templates, selectedTemplate]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- derive template param slots when selected template changes
    if (tpl) setTemplateParams(Array.from({ length: tpl.variableCount }, () => ""));
    else setTemplateParams([]);
  }, [tpl]);

  async function handleSend() {
    if (!businessId || !conversation) return;
    if (!composer.trim() && !selectedTemplate) {
      toast.error("Type a message or pick a template");
      return;
    }
    setSending(true);
    const body: Record<string, unknown> = {
      toPhone: conversation.phoneNumber,
      contactId: conversation.contactId ?? undefined,
    };
    if (selectedTemplate) {
      body.templateName = selectedTemplate;
      body.templateLanguage = tpl?.language ?? "en";
      body.templateParams = templateParams;
    } else {
      body.body = composer.trim();
    }
    if (scheduleAt) {
      body.scheduledAt = new Date(scheduleAt).toISOString();
    }
    const r = await apiPostSimple<{ id: string; status: string }>(`/whatsapp/businesses/${businessId}/messages`, body);
    setSending(false);
    if (r.error) {
      toast.error(r.error);
      return;
    }
    toast.success(scheduleAt ? "Message scheduled" : "Message sent");
    setComposer("");
    setSelectedTemplate("");
    setTemplateParams([]);
    setScheduleAt("");
    await loadConversation(conversation.id);
    await loadAll();
  }

  async function handleNewConversation() {
    if (!businessId) return;
    const phone = newPhone.trim();
    if (!phone) {
      toast.error("Phone number required");
      return;
    }
    if (!selectedTemplate) {
      toast.error("Pick a template to start a new conversation");
      return;
    }
    const body: Record<string, unknown> = {
      toPhone: phone,
      contactId: newContactId || undefined,
      templateName: selectedTemplate,
      templateLanguage: tpl?.language ?? "en",
      templateParams,
    };
    if (scheduleAt) body.scheduledAt = new Date(scheduleAt).toISOString();

    setSending(true);
    const r = await apiPostSimple<{ id: string; status: string }>(`/whatsapp/businesses/${businessId}/messages`, body);
    setSending(false);
    if (r.error) {
      toast.error(r.error);
      return;
    }
    toast.success(scheduleAt ? "Scheduled" : "Sent");
    setShowNew(false);
    setNewPhone("");
    setNewContactId("");
    setSelectedTemplate("");
    setTemplateParams([]);
    setScheduleAt("");
    await loadAll();
  }

  if (!businessId) {
    return <div className="p-8 text-center text-sm text-neutral-500">Loading workspace…</div>;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-6 h-6 animate-spin text-neutral-400" />
      </div>
    );
  }

  if (!status?.connected) {
    return (
      <WorkspaceShell icon={MessageCircle} title="WhatsApp" subtitle="Two-way WhatsApp Business inbox">
        <div className="max-w-lg mx-auto mt-12 p-8 border border-neutral-200 rounded-xl text-center bg-white">
          <MessageCircle className="w-12 h-12 mx-auto text-emerald-500 mb-4" />
          <h2 className="text-lg font-semibold mb-2">Connect WhatsApp Business</h2>
          <p className="text-sm text-neutral-600 mb-6">
            Link your WhatsApp Business number to send and receive messages directly from Keyflow.
          </p>
          <Link href="/app/key-connect">
            <Button>Connect WhatsApp</Button>
          </Link>
        </div>
      </WorkspaceShell>
    );
  }

  return (
    <WorkspaceShell
      icon={MessageCircle}
      title="WhatsApp"
      subtitle={status.destination?.displayName ?? "Connected"}
      actionLabel="New conversation"
      actionIcon={Plus}
      onAction={() => {
        setShowNew(true);
        void loadCrmContacts();
      }}
    >
      <div className="grid grid-cols-12 gap-4 h-[calc(100vh-220px)] min-h-[500px]">
        {/* Conversations list */}
        <div className="col-span-4 border border-neutral-200 rounded-lg bg-white overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="p-6 text-center text-sm text-neutral-500">
              No conversations yet. Start one with the “New conversation” button.
            </div>
          ) : (
            <ul className="divide-y divide-neutral-100">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setActiveId(c.id)}
                    className={`w-full text-left px-4 py-3 hover:bg-neutral-50 ${activeId === c.id ? "bg-emerald-50" : ""}`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-medium text-sm truncate">{c.displayName}</span>
                      <span className="text-xs text-neutral-400">{formatTime(c.lastMessageAt)}</span>
                    </div>
                    <div className="text-xs text-neutral-500 truncate">{c.lastMessageSnippet ?? c.phoneNumber}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Thread view */}
        <div className="col-span-8 border border-neutral-200 rounded-lg bg-white flex flex-col">
          {!conversation ? (
            <div className="flex-1 flex items-center justify-center text-sm text-neutral-500">
              Select a conversation to view messages
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b border-neutral-200 flex items-center justify-between">
                <div>
                  <div className="font-medium">{conversation.displayName}</div>
                  <div className="text-xs text-neutral-500">+{conversation.phoneNumber}</div>
                </div>
                <Badge>{conversation.withinWindow ? "24h window open" : "Out of window"}</Badge>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-neutral-50">
                {conversation.messages.length === 0 ? (
                  <div className="text-center text-sm text-neutral-500 py-8">No messages yet</div>
                ) : (
                  conversation.messages.map((m) => (
                    <div
                      key={m.id}
                      className={`flex ${m.direction === "OUTBOUND" ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
                          m.direction === "OUTBOUND" ? "bg-emerald-500 text-white" : "bg-white border border-neutral-200"
                        }`}
                      >
                        {m.templateName && (
                          <div className={`text-xs mb-1 ${m.direction === "OUTBOUND" ? "text-emerald-100" : "text-neutral-500"}`}>
                            Template: {m.templateName}
                          </div>
                        )}
                        <div className="whitespace-pre-wrap break-words">{m.body ?? "(no text)"}</div>
                        <div className={`text-[10px] mt-1 flex items-center gap-1 ${m.direction === "OUTBOUND" ? "text-emerald-100" : "text-neutral-400"}`}>
                          {m.status === "SCHEDULED" && <Clock className="w-3 h-3" />}
                          {m.status === "FAILED" && <AlertCircle className="w-3 h-3" />}
                          {(m.status === "SENT" || m.status === "RECEIVED") && <CheckCircle2 className="w-3 h-3" />}
                          <span>
                            {m.status === "SCHEDULED" && m.scheduledAt
                              ? `Scheduled for ${new Date(m.scheduledAt).toLocaleString()}`
                              : new Date(m.createdAt).toLocaleString()}
                          </span>
                          {m.errorMessage && <span className="text-red-200">· {m.errorMessage}</span>}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="border-t border-neutral-200 p-3 space-y-2">
                {!conversation.withinWindow && (
                  <div className="text-xs text-amber-700 bg-amber-50 px-2 py-1 rounded">
                    24h window closed — send a pre-approved template to re-open the conversation.
                  </div>
                )}

                <div className="flex gap-2">
                  <select
                    value={selectedTemplate}
                    onChange={(e) => setSelectedTemplate(e.target.value)}
                    className="text-xs border border-neutral-200 rounded px-2 py-1"
                  >
                    <option value="">Free-form text</option>
                    {templates.map((t) => (
                      <option key={t.name} value={t.name}>
                        Template: {t.name} ({t.language})
                      </option>
                    ))}
                  </select>
                  <input
                    type="datetime-local"
                    value={scheduleAt}
                    onChange={(e) => setScheduleAt(e.target.value)}
                    className="text-xs border border-neutral-200 rounded px-2 py-1"
                  />
                  {scheduleAt && (
                    <button
                      type="button"
                      onClick={() => setScheduleAt("")}
                      className="text-xs text-neutral-500 hover:underline"
                    >
                      clear
                    </button>
                  )}
                </div>

                {tpl && tpl.variableCount > 0 && (
                  <div className="space-y-1">
                    {templateParams.map((p, i) => (
                      <input
                        key={i}
                        value={p}
                        onChange={(e) => {
                          const next = [...templateParams];
                          next[i] = e.target.value;
                          setTemplateParams(next);
                        }}
                        placeholder={`Variable {{${i + 1}}}`}
                        className="w-full text-sm border border-neutral-200 rounded px-2 py-1"
                      />
                    ))}
                  </div>
                )}

                {!selectedTemplate && (
                  <textarea
                    value={composer}
                    onChange={(e) => setComposer(e.target.value)}
                    placeholder="Type a message…"
                    rows={3}
                    className="w-full text-sm border border-neutral-200 rounded px-2 py-2 resize-none"
                  />
                )}

                <div className="flex justify-end">
                  <Button onClick={handleSend} disabled={sending}>
                    {sending ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : scheduleAt ? (
                      <>
                        <Calendar className="w-4 h-4 mr-1" /> Schedule
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-1" /> Send
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* New conversation modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md space-y-3">
            <h3 className="text-lg font-semibold">New WhatsApp conversation</h3>

            <div>
              <label className="text-xs text-neutral-600">Pick CRM contact</label>
              <select
                value={newContactId}
                onChange={(e) => {
                  const id = e.target.value;
                  setNewContactId(id);
                  const c = crmContacts.find((x) => x.id === id);
                  if (c) setNewPhone((c.whatsappNumber || c.phone || "").replace(/[^0-9+]/g, ""));
                }}
                className="w-full text-sm border border-neutral-200 rounded px-2 py-2"
              >
                <option value="">— Select —</option>
                {crmContacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.displayName || `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.phone || c.whatsappNumber}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-neutral-600">Phone (E.164, digits only)</label>
              <input
                value={newPhone}
                onChange={(e) => setNewPhone(e.target.value)}
                placeholder="18681234567"
                className="w-full text-sm border border-neutral-200 rounded px-2 py-2"
              />
            </div>

            <div>
              <label className="text-xs text-neutral-600">Template (required for new conversation)</label>
              <select
                value={selectedTemplate}
                onChange={(e) => setSelectedTemplate(e.target.value)}
                className="w-full text-sm border border-neutral-200 rounded px-2 py-2"
              >
                <option value="">— Select template —</option>
                {templates.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.name} ({t.language})
                  </option>
                ))}
              </select>
            </div>

            {tpl && tpl.variableCount > 0 && (
              <div className="space-y-1">
                {templateParams.map((p, i) => (
                  <input
                    key={i}
                    value={p}
                    onChange={(e) => {
                      const next = [...templateParams];
                      next[i] = e.target.value;
                      setTemplateParams(next);
                    }}
                    placeholder={`Variable {{${i + 1}}}`}
                    className="w-full text-sm border border-neutral-200 rounded px-2 py-1"
                  />
                ))}
              </div>
            )}

            <div>
              <label className="text-xs text-neutral-600">Schedule (optional)</label>
              <input
                type="datetime-local"
                value={scheduleAt}
                onChange={(e) => setScheduleAt(e.target.value)}
                className="w-full text-sm border border-neutral-200 rounded px-2 py-2"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowNew(false)} disabled={sending}>
                Cancel
              </Button>
              <Button onClick={handleNewConversation} disabled={sending}>
                {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : scheduleAt ? "Schedule" : "Send"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </WorkspaceShell>
  );
}
