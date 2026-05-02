"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Send,
  Clock,
  Save,
  Loader2,
  ImagePlus,
  X,
  Sparkles,
  Wand2,
  Target,
  Hash,
  MessageSquare,
  Eye,
  EyeOff,
  Mail,
  PenSquare,
  Calendar,
  AlertCircle,
  CheckCircle,
  ArrowRight,
  Layers,
  FileText,
  Image as ImageIcon,
  AlertTriangle,
  Info,
  Minimize2,
  Maximize2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  createOutboundContent,
  updateOutboundContent,
  upsertOutboundVariant,
  publishContentNow,
  scheduleContent,
  getOutboundContent,
  aiGenerateDraft,
  aiRewriteContent,
  aiSuggestSubjects,
  aiSuggestCta,
  aiSuggestHashtags,
  aiShortenExpand,
  aiSuggestSendTime,
  aiSuggestChannels,
  aiSuggestPreviewText,
  aiSuggestAudienceSegments,
  aiSuggestContentIdeas,
} from "@/lib/client";
import type { ChannelDestination, OutboundContent } from "@/lib/client";
import { ChannelSelector } from "./channel-selector";
import { ChannelVariantsPanel, type VariantData } from "./channel-variants-panel";
import { ChannelPreviewPanel } from "./channel-preview-panel";
import { AudienceSelector } from "./audience-selector";
import Image from "next/image";

type ContentTypeOption = "social" | "email" | "messaging" | "multi";
type ComposerStep = "compose" | "distribute" | "review";

const DRAFT_STORAGE_KEY = "kf_composer_draft";

interface UnifiedComposerProps {
  businessId: string;
  businessName?: string;
  editContentId?: string;
  initialContentType?: ContentTypeOption;
  initialBody?: string;
  initialSubject?: string;
  onContentCreated?: (content: OutboundContent) => void;
  onClose?: () => void;
  healthData?: import("@/hooks/use-channel-health").ChannelHealthData;
}

const OBJECTIVES = [
  { key: "awareness", label: "Awareness", emoji: "👁️" },
  { key: "engagement", label: "Engagement", emoji: "💬" },
  { key: "promotion", label: "Promotion", emoji: "🔥" },
  { key: "lead_capture", label: "Lead Capture", emoji: "🎯" },
  { key: "nurture", label: "Nurture", emoji: "💛" },
  { key: "reminder", label: "Reminder", emoji: "🔔" },
  { key: "announcement", label: "Announcement", emoji: "📢" },
  { key: "re_engagement", label: "Re-engagement", emoji: "🔄" },
] as const;

const TONES = [
  { key: "informative", label: "Informative" },
  { key: "promotional", label: "Promotional" },
  { key: "warm", label: "Warm" },
  { key: "authority", label: "Authority" },
  { key: "concise", label: "Concise" },
] as const;

const AUDIENCES = [
  { key: "all", label: "All Contacts" },
  { key: "vip", label: "VIP" },
  { key: "new", label: "New Leads" },
  { key: "active", label: "Active" },
  { key: "at_risk", label: "At-Risk" },
] as const;

const CONTENT_TYPE_OPTIONS: { key: ContentTypeOption; label: string; icon: React.ElementType; desc: string }[] = [
  { key: "social", label: "Social Post", icon: PenSquare, desc: "Facebook, Instagram, etc." },
  { key: "email", label: "Email", icon: Mail, desc: "Newsletter, campaign" },
  { key: "messaging", label: "Messaging", icon: MessageSquare, desc: "WhatsApp, direct messages" },
  { key: "multi", label: "Multi-Channel", icon: Layers, desc: "Distribute everywhere" },
];

const AI_ACTIONS: { key: string; label: string; icon: LucideIcon; desc: string; needsBody?: boolean }[] = [
  { key: "generate", label: "Generate Draft", icon: Sparkles, desc: "AI writes based on your objective" },
  { key: "rewrite", label: "Rewrite", icon: Wand2, desc: "Optimize for channel", needsBody: true },
  { key: "cta", label: "Add CTA", icon: Target, desc: "Compelling call-to-action", needsBody: true },
  { key: "hashtags", label: "Hashtags", icon: Hash, desc: "Auto-generate tags", needsBody: true },
  { key: "subjects", label: "Subject Lines", icon: Mail, desc: "AI subject suggestions", needsBody: true },
  { key: "shorten", label: "Shorten", icon: Minimize2, desc: "Make it concise", needsBody: true },
  { key: "expand", label: "Expand", icon: Maximize2, desc: "Add more detail", needsBody: true },
  { key: "send_time", label: "Best Time", icon: Clock, desc: "Optimal send time" },
  { key: "channels", label: "Suggest Channels", icon: Layers, desc: "Best channels for this", needsBody: true },
  { key: "preview_text", label: "Preview Text", icon: Eye, desc: "Email preheader text", needsBody: true },
  { key: "audience", label: "Audience Segments", icon: Target, desc: "AI-recommended segments", needsBody: true },
  { key: "ideas", label: "Content Ideas", icon: Zap, desc: "Cross-module inspiration" },
];

const STEPS: { key: ComposerStep; label: string; num: number }[] = [
  { key: "compose", label: "Compose", num: 1 },
  { key: "distribute", label: "Distribute", num: 2 },
  { key: "review", label: "Review & Send", num: 3 },
];

const TIMEZONES = [
  { value: "America/Port_of_Spain", label: "Trinidad (AST)" },
  { value: "America/New_York", label: "Eastern (ET)" },
  { value: "America/Chicago", label: "Central (CT)" },
  { value: "America/Los_Angeles", label: "Pacific (PT)" },
  { value: "Europe/London", label: "London (GMT/BST)" },
  { value: "America/Jamaica", label: "Jamaica (EST)" },
  { value: "America/Barbados", label: "Barbados (AST)" },
];

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

function getAuthHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const token = window.localStorage?.getItem("kf_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function inferContentType(destinations: ChannelDestination[]): ContentTypeOption {
  if (destinations.length === 0) return "social";
  const platforms = new Set(destinations.map((d) => d.platform.toUpperCase()));
  const hasEmail = platforms.has("GOOGLE") || platforms.has("EMAIL");
  const hasWhatsApp = platforms.has("WHATSAPP");
  const hasSocial = platforms.has("FACEBOOK") || platforms.has("INSTAGRAM") || platforms.has("META");
  const hasMultipleChannelTypes = [hasEmail, hasWhatsApp, hasSocial].filter(Boolean).length > 1;
  if (hasMultipleChannelTypes) return "multi";
  if (hasEmail) return "email";
  if (hasWhatsApp) return "messaging";
  return "social";
}

const PLATFORM_MAP: Record<string, string> = { GOOGLE: "EMAIL", META: "FACEBOOK" };

interface ChannelWarning {
  platform: string;
  message: string;
  severity: "error" | "warning";
}

function resolveEffectiveContent(
  dest: ChannelDestination,
  masterBody: string,
  masterSubject: string,
  variants: VariantData[],
): { body: string; subject: string } {
  const variant = variants.find(v => v.destinationId === dest.id && v.customized);
  return {
    body: variant?.textBody || masterBody,
    subject: variant?.subject || masterSubject,
  };
}

function getChannelWarnings(
  destinations: ChannelDestination[],
  masterBody: string,
  masterSubject: string,
  mediaUrls: string[],
  variants: VariantData[],
): ChannelWarning[] {
  const warnings: ChannelWarning[] = [];
  const seen = new Set<string>();

  for (const dest of destinations) {
    const plat = (PLATFORM_MAP[dest.platform.toUpperCase()] || dest.platform).toUpperCase();
    const { body: effBody, subject: effSubject } = resolveEffectiveContent(dest, masterBody, masterSubject, variants);
    const key = `${plat}:${dest.id}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (plat === "INSTAGRAM" && mediaUrls.length === 0) {
      warnings.push({ platform: "Instagram", message: "Instagram posts require at least one image or video", severity: "error" });
    }
    if (plat === "EMAIL" && !effSubject.trim()) {
      warnings.push({ platform: "Email", message: `Email requires a subject line${dest.displayName ? ` (${dest.displayName})` : ""}`, severity: "error" });
    }
    if (plat === "WHATSAPP" && effBody.length > 4096) {
      warnings.push({ platform: "WhatsApp", message: `Content exceeds WhatsApp limit (${effBody.length}/4096 chars)`, severity: "error" });
    }
    if (plat === "INSTAGRAM" && effBody.length > 2200) {
      warnings.push({ platform: "Instagram", message: `Caption exceeds limit (${effBody.length}/2200 chars)`, severity: "warning" });
    }
    if (plat === "FACEBOOK" && effBody.length > 63206) {
      warnings.push({ platform: "Facebook", message: `Post exceeds Facebook limit`, severity: "warning" });
    }
  }
  return warnings;
}

interface DraftState {
  body: string;
  subject: string;
  objective: string;
  tone: string;
  audience: string;
  contentType: string;
  mediaUrls: string[];
  selectedDestinationIds?: string[];
  variants?: VariantData[];
  scheduleMode?: string;
  scheduledAt?: string;
  timezone?: string;
  savedAt?: number;
}

function saveDraftToStorage(data: DraftState) {
  try { sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify({ ...data, savedAt: Date.now() })); } catch {}
}

function loadDraftFromStorage(): DraftState | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - (parsed.savedAt ?? 0) > 24 * 60 * 60 * 1000) {
      sessionStorage.removeItem(DRAFT_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch { return null; }
}

function clearDraftFromStorage() {
  try { sessionStorage.removeItem(DRAFT_STORAGE_KEY); } catch {}
}

function loadCrossModulePrefill(): { body?: string; subject?: string } {
  const result: { body?: string; subject?: string } = {};
  try {
    const b = sessionStorage.getItem("kf_composer_body");
    const s = sessionStorage.getItem("kf_composer_subject");
    if (b) { result.body = b; sessionStorage.removeItem("kf_composer_body"); }
    if (s) { result.subject = s; sessionStorage.removeItem("kf_composer_subject"); }
  } catch {}
  return result;
}

export function UnifiedComposer({
  businessId,
  businessName,
  editContentId,
  initialContentType = "social",
  initialBody = "",
  initialSubject = "",
  onContentCreated,
  onClose,
  healthData,
}: UnifiedComposerProps) {
  const [step, setStep] = useState<ComposerStep>("compose");
  const [contentType, setContentType] = useState<ContentTypeOption>(initialContentType);
  const [body, setBody] = useState(initialBody);
  const [subject, setSubject] = useState(initialSubject);
  const [previewText, setPreviewText] = useState("");
  const [objective, setObjective] = useState("");
  const [tone, setTone] = useState("");
  const [audience, setAudience] = useState("all");
  const [mediaUrls, setMediaUrls] = useState<string[]>([]);
  const [selectedDestinations, setSelectedDestinations] = useState<ChannelDestination[]>([]);
  const [variants, setVariants] = useState<VariantData[]>([]);
  const [showPreview, setShowPreview] = useState(false);
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState("");
  const [timezone, setTimezone] = useState("America/Port_of_Spain");
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [savedContentId, setSavedContentId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [segmentTags, setSegmentTags] = useState<string[]>([]);
  const [emailValidation, setEmailValidation] = useState<import("@/lib/client").EmailValidationResult | null>(null);
  const [aiRunning, setAiRunning] = useState<string | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<{ type: string; data: unknown } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editContentId) {
      void (async () => {
        const res = await getOutboundContent(editContentId, businessId);
        if (res.data) {
          const c = res.data;
          setBody(c.body || "");
          setSubject(c.subject || "");
          setObjective(c.objective || "");
          setTone(c.tone || "");
          setAudience(c.audience || "all");
          setMediaUrls(c.mediaUrls || []);
          setSavedContentId(c.id);
          if (c.contentType === "campaign_email") setContentType("email");
          else if (c.contentType === "whatsapp_message") setContentType("messaging");
          else if (c.contentType === "multi_channel_broadcast") setContentType("multi");
          else setContentType("social");

          if (c.deliveries && c.deliveries.length > 0) {
            const destIds = [...new Set(c.deliveries.map(d => d.destinationId))];
            const { listChannelDestinations } = await import("@/lib/client");
            const destRes = await listChannelDestinations(businessId);
            if (destRes.data) {
              const restored = destRes.data.filter(d => destIds.includes(d.id));
              if (restored.length > 0) setSelectedDestinations(restored);
            }
          }

          if (c.variants && c.variants.length > 0) {
            const meta = (v: typeof c.variants[0]) => (v.metadata || {}) as Record<string, string>;
            setVariants(c.variants.map(v => ({
              destinationId: v.destinationId,
              platform: v.platform,
              textBody: v.body || c.body || "",
              subject: v.subject || meta(v).subject,
              previewText: meta(v).previewText,
              hashtags: meta(v).hashtags,
              customized: true,
            })));
          }

          if (c.scheduledAt) {
            setScheduleMode("later");
            setScheduledAt(new Date(c.scheduledAt).toISOString().slice(0, 16));
          }
          if (c.timezone) setTimezone(c.timezone);

          setDraftRestored(true);
        }
      })();
      return;
    }

    const prefill = loadCrossModulePrefill();
    if (prefill.body) setBody(prefill.body);
    if (prefill.subject) setSubject(prefill.subject);

    if (!prefill.body && !prefill.subject) {
      const draft = loadDraftFromStorage();
      if (draft && draft.body) {
        setBody(draft.body);
        setSubject(draft.subject || "");
        setObjective(draft.objective || "");
        setTone(draft.tone || "");
        setAudience(draft.audience || "all");
        setContentType((draft.contentType as ContentTypeOption) || "social");
        setMediaUrls(draft.mediaUrls || []);
        if (draft.variants && draft.variants.length > 0) setVariants(draft.variants);
        if (draft.scheduleMode) setScheduleMode(draft.scheduleMode as "now" | "later");
        if (draft.scheduledAt) setScheduledAt(draft.scheduledAt);
        if (draft.timezone) setTimezone(draft.timezone);
        if (draft.selectedDestinationIds && draft.selectedDestinationIds.length > 0) {
          void (async () => {
            const { listChannelDestinations } = await import("@/lib/client");
            const destRes = await listChannelDestinations(businessId);
            if (destRes.data) {
              const restored = destRes.data.filter(d => draft.selectedDestinationIds!.includes(d.id));
              if (restored.length > 0) setSelectedDestinations(restored);
            }
          })();
        }
        setDraftRestored(true);
      }
    }
  }, [editContentId, businessId]);

  useEffect(() => {
    if (body.trim()) {
      saveDraftToStorage({
        body, subject, objective, tone, audience, contentType, mediaUrls,
        selectedDestinationIds: selectedDestinations.map(d => d.id),
        variants: variants.filter(v => v.customized),
        scheduleMode, scheduledAt, timezone,
      });
    }
  }, [body, subject, objective, tone, audience, contentType, mediaUrls, selectedDestinations, variants, scheduleMode, scheduledAt, timezone]);

  const handleDestinationChange = useCallback((dests: ChannelDestination[]) => {
    setSelectedDestinations(dests);
    const inferred = inferContentType(dests);
    setContentType(inferred);
  }, []);

  const charCount = body.length;
  const maxChars = contentType === "social" ? 2200 : contentType === "messaging" ? 4096 : 0;

  const contentTypeForApi = useMemo(() => {
    if (contentType === "email") return "campaign_email";
    if (contentType === "messaging") return "whatsapp_message";
    if (contentType === "social") return "social_post";
    return "multi_channel_broadcast";
  }, [contentType]);

  const selectedPlatforms = useMemo(() => {
    const platforms = selectedDestinations.map((d) => {
      const upper = d.platform.toUpperCase();
      return PLATFORM_MAP[upper] || upper;
    });
    return [...new Set(platforms)] as ("FACEBOOK" | "INSTAGRAM" | "EMAIL" | "WHATSAPP" | "GENERIC")[];
  }, [selectedDestinations]);

  const channelWarnings = useMemo(
    () => getChannelWarnings(selectedDestinations, body, subject, mediaUrls, variants),
    [selectedDestinations, body, subject, mediaUrls, variants],
  );

  const hasBlockingWarnings = channelWarnings.some((w) => w.severity === "error");

  const canAdvanceToDistribute = body.trim().length > 0;
  const canAdvanceToReview = selectedDestinations.length > 0;
  const hasEmailDestination = selectedDestinations.some(d => {
    const p = d.platform.toUpperCase();
    return p === "EMAIL" || p === "GOOGLE";
  });
  const hasEmailValidationErrors = hasEmailDestination && emailValidation && !emailValidation.valid;
  const canPublish = canAdvanceToReview && !hasBlockingWarnings && !hasEmailValidationErrors;
  const readinessScore = useMemo(() => {
    let score = 0;
    if (body.trim()) score += 25;
    if (objective) score += 10;
    if (tone) score += 10;
    if (selectedDestinations.length > 0) score += 20;
    const needsSubject = contentType === "email" || (contentType === "multi" && selectedDestinations.some(d => { const p = d.platform.toUpperCase(); return p === "EMAIL" || p === "GOOGLE"; }));
    if (needsSubject && subject.trim()) score += 10;
    if (!needsSubject) score += 10;
    if (mediaUrls.length > 0) score += 10;
    if (scheduleMode === "later" && scheduledAt) score += 10;
    if (scheduleMode === "now") score += 10;
    if (!hasBlockingWarnings && selectedDestinations.length > 0) score += 5;
    return Math.min(score, 100);
  }, [body, objective, tone, selectedDestinations, contentType, subject, scheduleMode, scheduledAt, mediaUrls, hasBlockingWarnings]);

  const handleAiAction = useCallback(async (actionKey: string) => {
    if (aiRunning) return;
    const action = AI_ACTIONS.find(a => a.key === actionKey);
    if (!action) return;
    if (action.needsBody && !body.trim()) {
      toast.error("Write some content first, then use AI to enhance it");
      return;
    }
    setAiRunning(actionKey);
    setAiSuggestions(null);
    try {
      switch (actionKey) {
        case "generate": {
          const res = await aiGenerateDraft({ contentType, objective, tone, audience, existingBody: body || undefined }, businessId);
          if (res.error) { toast.error(res.error); break; }
          if (res.data?.body) {
            setBody(res.data.body);
            if (res.data.subject && (contentType === "email" || contentType === "multi")) setSubject(res.data.subject);
            toast.success("Draft generated");
          }
          break;
        }
        case "rewrite": {
          const res = await aiRewriteContent({ body, targetChannel: contentType, tone, objective }, businessId);
          if (res.error) { toast.error(res.error); break; }
          if (res.data?.body) {
            setBody(res.data.body);
            if (res.data.subject && (contentType === "email" || contentType === "multi")) setSubject(res.data.subject);
            const rewriteData = res.data as { body: string; previewText?: string };
            if (rewriteData.previewText && (contentType === "email" || contentType === "multi")) setPreviewText(rewriteData.previewText);
            toast.success("Content rewritten");
          }
          break;
        }
        case "cta": {
          const res = await aiSuggestCta({ body, objective, contentType }, businessId);
          if (res.error) { toast.error(res.error); break; }
          if (res.data?.ctas?.length) {
            setAiSuggestions({ type: "cta", data: res.data.ctas });
          }
          break;
        }
        case "hashtags": {
          const res = await aiSuggestHashtags({ body }, businessId);
          if (res.error) { toast.error(res.error); break; }
          if (res.data?.hashtags?.length) {
            const tags = res.data.hashtags.map(h => h.startsWith("#") ? h : `#${h}`).join(" ");
            setBody(prev => prev.trimEnd() + "\n\n" + tags);
            toast.success(`Added ${res.data.hashtags.length} hashtags`);
          }
          break;
        }
        case "subjects": {
          const res = await aiSuggestSubjects({ body, objective, tone, audience }, businessId);
          if (res.error) { toast.error(res.error); break; }
          if (res.data?.subjects?.length) {
            setAiSuggestions({ type: "subjects", data: res.data.subjects });
          }
          break;
        }
        case "shorten": {
          const res = await aiShortenExpand({ body, action: "shorten", targetChannel: contentType }, businessId);
          if (res.error) { toast.error(res.error); break; }
          if (res.data?.body) { setBody(res.data.body); toast.success("Content shortened"); }
          break;
        }
        case "expand": {
          const res = await aiShortenExpand({ body, action: "expand", targetChannel: contentType }, businessId);
          if (res.error) { toast.error(res.error); break; }
          if (res.data?.body) { setBody(res.data.body); toast.success("Content expanded"); }
          break;
        }
        case "send_time": {
          const res = await aiSuggestSendTime({ contentType, audience, timezone }, businessId);
          if (res.error) { toast.error(res.error); break; }
          if (res.data?.suggestions?.length) {
            setAiSuggestions({ type: "send_time", data: res.data });
          }
          break;
        }
        case "channels": {
          const channelNames = selectedDestinations.length > 0
            ? selectedDestinations.map(d => d.platform || d.displayName || "unknown")
            : ["email", "social", "whatsapp"];
          const res = await aiSuggestChannels({ body, objective, audience, availableChannels: channelNames }, businessId);
          if (res.error) { toast.error(res.error); break; }
          if (res.data?.recommended?.length) {
            setAiSuggestions({ type: "channels", data: res.data.recommended });
          }
          break;
        }
        case "preview_text": {
          const res = await aiSuggestPreviewText({ subject: subject || "Untitled", body, objective }, businessId);
          if (res.error) { toast.error(res.error); break; }
          if (res.data?.previews?.length) {
            setAiSuggestions({ type: "preview_text", data: res.data.previews });
          }
          break;
        }
        case "audience": {
          const res = await aiSuggestAudienceSegments({ body, contentType, objective }, businessId);
          if (res.error) { toast.error(res.error); break; }
          if (res.data?.segments?.length) {
            setAiSuggestions({ type: "audience", data: { segments: res.data.segments, primarySegment: res.data.primarySegment } });
          }
          break;
        }
        case "ideas": {
          const res = await aiSuggestContentIdeas({ objective, audience, contentType }, businessId);
          if (res.error) { toast.error(res.error); break; }
          if (res.data?.ideas?.length) {
            setAiSuggestions({ type: "ideas", data: res.data.ideas });
          }
          break;
        }
      }
    } catch {
      toast.error("AI action failed — try again");
    } finally {
      setAiRunning(null);
    }
  }, [aiRunning, body, contentType, objective, tone, audience, businessId, timezone, selectedDestinations, subject]);

  const handleMediaUpload = useCallback(async (files: FileList) => {
    if (files.length === 0) return;
    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        formData.append("file", file);

        const res = await fetch(`${API_BASE}/upload/businesses/${encodeURIComponent(businessId)}/media`, {
          method: "POST",
          headers: getAuthHeaders(),
          body: formData,
        });
        if (res.ok) {
          const data = await res.json();
          if (data.url) {
            setMediaUrls((prev) => [...prev, data.url]);
          }
        } else {
          toast.error(`Failed to upload ${file.name}`);
        }
      }
    } catch {
      toast.error("Media upload failed");
    } finally {
      setUploading(false);
    }
  }, [businessId]);

  const removeMedia = useCallback((index: number) => {
    setMediaUrls((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const persistVariants = useCallback(async (contentId: string) => {
    const customVariants = variants.filter((v) => v.customized);
    let failed = 0;
    for (const v of customVariants) {

      const variantMeta: Record<string, unknown> = {};
      if (v.subject) variantMeta.subject = v.subject;
      if (v.previewText) variantMeta.previewText = v.previewText;
      if (v.senderName) variantMeta.senderName = v.senderName;
      if (v.hashtags) variantMeta.hashtags = v.hashtags;
      if (v.templateName) variantMeta.templateName = v.templateName;
      if (v.templateLanguage) variantMeta.templateLanguage = v.templateLanguage;

      const res = await upsertOutboundVariant(contentId, {
        platform: v.platform,
        textBody: v.textBody,
        destinationId: v.destinationId,
        variantMeta: Object.keys(variantMeta).length > 0 ? variantMeta : undefined,
      }, businessId);
      if (res.error) { failed++; }
    }
    if (failed > 0) toast.error(`${failed} variant(s) failed to save`);
  }, [variants, businessId]);

  const handleSaveDraft = useCallback(async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      if (savedContentId) {
        const res = await updateOutboundContent(savedContentId, {
          body, subject: subject || undefined, objective: objective || undefined,
          audience: audience || undefined, tone: tone || undefined, mediaUrls,
          segmentTags: segmentTags.length > 0 ? segmentTags : undefined,
        }, businessId);
        if (res.error) { toast.error(res.error); return; }
        await persistVariants(savedContentId);
        toast.success("Draft updated");
      } else {
        const res = await createOutboundContent({
          contentType: contentTypeForApi, body,
          subject: subject || undefined, objective: objective || undefined,
          audience: audience || undefined, tone: tone || undefined,
          mediaUrls, tags: [],
          segmentTags: segmentTags.length > 0 ? segmentTags : undefined,
        }, businessId);
        if (res.error) { toast.error(res.error); return; }
        if (res.data) {
          setSavedContentId(res.data.id);
          onContentCreated?.(res.data);
          await persistVariants(res.data.id);
          toast.success("Draft saved");
        }
      }
    } finally {
      setSaving(false);
    }
  }, [body, subject, objective, audience, tone, mediaUrls, savedContentId, businessId, contentTypeForApi, onContentCreated, persistVariants, segmentTags]);

  const handlePublish = useCallback(async () => {
    if (!body.trim() || selectedDestinations.length === 0 || hasBlockingWarnings) return;
    setPublishing(true);
    try {
      let contentId = savedContentId;
      if (!contentId) {
        const createRes = await createOutboundContent({
          contentType: contentTypeForApi, body,
          subject: subject || undefined, objective: objective || undefined,
          audience: audience || undefined, tone: tone || undefined,
          mediaUrls, tags: [],
          segmentTags: segmentTags.length > 0 ? segmentTags : undefined,
        }, businessId);
        if (createRes.error || !createRes.data) {
          toast.error(createRes.error || "Failed to create content");
          return;
        }
        contentId = createRes.data.id;
        setSavedContentId(contentId);
        onContentCreated?.(createRes.data);
      }

      await persistVariants(contentId);

      const destIds = selectedDestinations.map((d) => d.id);

      if (scheduleMode === "later" && scheduledAt) {
        const res = await scheduleContent(contentId, {
          destinationIds: destIds,
          scheduledAt,
          timezone,
        }, businessId);
        if (res.error) { toast.error(res.error); return; }
        toast.success(`Scheduled for ${new Date(scheduledAt).toLocaleString("en-TT")}`);
      } else {
        const res = await publishContentNow(contentId, destIds, businessId);
        if (res.error) { toast.error(res.error); return; }
        toast.success("Publishing to all channels...");
      }
      clearDraftFromStorage();
      onClose?.();
    } finally {
      setPublishing(false);
    }
  }, [body, subject, objective, audience, tone, mediaUrls, selectedDestinations, savedContentId, businessId, contentTypeForApi, scheduleMode, scheduledAt, timezone, onContentCreated, onClose, hasBlockingWarnings, segmentTags, persistVariants]);

  return (
    <div className="space-y-4">
      {draftRestored && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[hsl(var(--kf-accent2))]/10 border border-[hsl(var(--kf-accent2))]/20 text-xs">
          <Info className="w-3.5 h-3.5 text-[hsl(var(--kf-accent2))]" />
          <span className="text-[hsl(var(--kf-accent2))]">Previous draft restored</span>
          <button onClick={() => { setBody(""); setSubject(""); setObjective(""); setTone(""); setAudience("all"); setMediaUrls([]); clearDraftFromStorage(); setDraftRestored(false); }} className="ml-auto text-[10px] text-muted-foreground hover:text-foreground">
            Discard
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 px-1 flex-wrap">
        {STEPS.map((s, i) => (
          <button
            key={s.key}
            onClick={() => {
              if (s.key === "distribute" && !canAdvanceToDistribute) return;
              if (s.key === "review" && !canAdvanceToReview) return;
              setStep(s.key);
            }}
            className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
              step === s.key
                ? "text-[hsl(var(--kf-accent1))]"
                : s.key === "distribute" && !canAdvanceToDistribute
                  ? "text-muted-foreground/40 cursor-not-allowed"
                  : s.key === "review" && !canAdvanceToReview
                    ? "text-muted-foreground/40 cursor-not-allowed"
                    : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className={`w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${
              step === s.key
                ? "bg-[hsl(var(--kf-accent1))]/20 text-[hsl(var(--kf-accent1))]"
                : "bg-muted/20 text-muted-foreground"
            }`}>{s.num}</span>
            {s.label}
            {i < STEPS.length - 1 && <ArrowRight className="w-3 h-3 text-muted-foreground/30 ml-1" />}
          </button>
        ))}

        <div className="ml-auto flex items-center gap-2">
          <div className="relative group">
            <div className="flex items-center gap-1.5 cursor-default">
              <svg width="24" height="24" viewBox="0 0 24 24" className="shrink-0">
                <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted/20" />
                <circle
                  cx="12" cy="12" r="10" fill="none"
                  stroke="url(#readinessGrad)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray={`${(readinessScore / 100) * 62.83} 62.83`}
                  transform="rotate(-90 12 12)"
                  className="transition-all duration-700"
                />
                <defs>
                  <linearGradient id="readinessGrad" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor="hsl(var(--kf-accent1))" />
                    <stop offset="100%" stopColor="hsl(var(--kf-accent2))" />
                  </linearGradient>
                </defs>
                <text x="12" y="12" textAnchor="middle" dominantBaseline="central" className="fill-current text-[7px] font-bold" fill="currentColor">
                  {readinessScore}
                </text>
              </svg>
              <span className="text-[9px] text-muted-foreground">Ready</span>
            </div>
            <div className="absolute right-0 top-full mt-1 z-50 w-56 rounded-xl border border-border/30 bg-card shadow-xl p-3 space-y-1.5 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 mb-2">Content Readiness</div>
              {(() => {
                const hasEmailDest = selectedDestinations.some(d => { const p = d.platform.toUpperCase(); return p === "EMAIL" || p === "GOOGLE"; });
                const showSubject = contentType === "email" || (contentType === "multi" && hasEmailDest);
                return [
                  { label: "Content body", done: body.trim().length > 0 },
                  { label: "Subject line", done: subject.trim().length > 0, hide: !showSubject },
                  { label: "Objective set", done: !!objective },
                  { label: "Tone selected", done: !!tone },
                  { label: "Channels selected", done: selectedDestinations.length > 0 },
                  { label: "Audience targeted", done: audience !== "all" || segmentTags.length > 0 },
                  { label: "Media attached", done: mediaUrls.length > 0 },
                  { label: "Delivery scheduled", done: scheduleMode === "later" ? !!scheduledAt : true },
                ];
              })().filter(item => !item.hide).map((item) => (
                <div key={item.label} className="flex items-center gap-2 text-[11px]">
                  {item.done ? (
                    <CheckCircle className="w-3 h-3 text-emerald-400 shrink-0" />
                  ) : (
                    <div className="w-3 h-3 rounded-full border border-muted-foreground/30 shrink-0" />
                  )}
                  <span className={item.done ? "text-foreground" : "text-muted-foreground"}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
          <button
            onClick={() => setShowPreview(!showPreview)}
            className={`p-1.5 rounded-lg transition-colors ${showPreview ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))]" : "hover:bg-muted/20 text-muted-foreground"}`}
          >
            {showPreview ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      <div className={`grid gap-4 ${showPreview ? "grid-cols-1 lg:grid-cols-[1fr_320px]" : "grid-cols-1"}`}>
        <div className="space-y-4">
          <AnimatePresence mode="wait">
            {step === "compose" && (
              <motion.div key="compose" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted/20 border border-border/30 w-fit">
                  {CONTENT_TYPE_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.key}
                        onClick={() => setContentType(opt.key)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                          contentType === opt.key
                            ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] shadow-sm"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" /> {opt.label}
                      </button>
                    );
                  })}
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <div className="flex items-center gap-1">
                    <Target className="w-3 h-3 text-muted-foreground" />
                    <select
                      value={objective}
                      onChange={(e) => setObjective(e.target.value)}
                      className="text-[11px] bg-transparent border border-border/30 rounded-md px-2 py-1 text-foreground focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
                    >
                      <option value="">Objective</option>
                      {OBJECTIVES.map((o) => <option key={o.key} value={o.key}>{o.emoji} {o.label}</option>)}
                    </select>
                  </div>
                  <select
                    value={tone}
                    onChange={(e) => setTone(e.target.value)}
                    className="text-[11px] bg-transparent border border-border/30 rounded-md px-2 py-1 text-foreground focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
                  >
                    <option value="">Tone</option>
                    {TONES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                  <select
                    value={audience}
                    onChange={(e) => setAudience(e.target.value)}
                    className="text-[11px] bg-transparent border border-border/30 rounded-md px-2 py-1 text-foreground focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
                  >
                    {AUDIENCES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                  </select>
                  <button
                    onClick={() => setShowAiPanel(!showAiPanel)}
                    className={`flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-md transition-colors ${
                      showAiPanel ? "bg-purple-500/15 text-purple-400" : "text-purple-400/70 hover:text-purple-400 hover:bg-purple-500/10"
                    }`}
                  >
                    <Sparkles className="w-3 h-3" /> AI Actions
                  </button>
                </div>

                <AnimatePresence>
                  {showAiPanel && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-2 space-y-2">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                          {AI_ACTIONS.map((action) => {
                            const AIcon = action.icon;
                            const isRunning = aiRunning === action.key;
                            const disabled = !!aiRunning || (action.needsBody && !body.trim());
                            return (
                              <button
                                key={action.key}
                                disabled={disabled}
                                className={`flex items-center gap-2 p-2 rounded-lg transition-colors text-left ${
                                  isRunning ? "bg-purple-500/20 ring-1 ring-purple-500/40" : disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-purple-500/10"
                                }`}
                                onClick={() => void handleAiAction(action.key)}
                              >
                                {isRunning ? <Loader2 className="w-3.5 h-3.5 text-purple-400 animate-spin shrink-0" /> : <AIcon className="w-3.5 h-3.5 text-purple-400 shrink-0" />}
                                <div className="min-w-0">
                                  <span className="text-[10px] font-medium text-purple-300 block truncate">{action.label}</span>
                                  <span className="text-[9px] text-purple-400/50 block truncate">{action.desc}</span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        {aiSuggestions && (
                          <div className="rounded-lg bg-purple-500/10 border border-purple-500/20 p-2 space-y-1.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-purple-400">
                                {aiSuggestions.type === "subjects" ? "Subject Line Suggestions" : aiSuggestions.type === "cta" ? "CTA Suggestions" : aiSuggestions.type === "channels" ? "Channel Suggestions" : aiSuggestions.type === "preview_text" ? "Preview Text Suggestions" : aiSuggestions.type === "audience" ? "Audience Segments" : aiSuggestions.type === "ideas" ? "Content Ideas" : "Send Time Suggestions"}
                              </span>
                              <button onClick={() => setAiSuggestions(null)} className="p-0.5 rounded hover:bg-purple-500/20">
                                <X className="w-3 h-3 text-purple-400" />
                              </button>
                            </div>
                            {aiSuggestions.type === "subjects" && (
                              <div className="space-y-1">
                                {(aiSuggestions.data as string[]).map((s, i) => (
                                  <button key={i} onClick={() => { setSubject(s); setAiSuggestions(null); toast.success("Subject applied"); }} className="block w-full text-left text-[11px] text-purple-200 px-2 py-1.5 rounded-md hover:bg-purple-500/15 transition-colors">
                                    {s}
                                  </button>
                                ))}
                              </div>
                            )}
                            {aiSuggestions.type === "cta" && (
                              <div className="space-y-1">
                                {(aiSuggestions.data as { text: string; style: string }[]).map((c, i) => (
                                  <button key={i} onClick={() => { setBody(prev => prev.trimEnd() + "\n\n" + c.text); setAiSuggestions(null); toast.success("CTA added"); }} className="flex items-center justify-between w-full text-left text-[11px] text-purple-200 px-2 py-1.5 rounded-md hover:bg-purple-500/15 transition-colors">
                                    <span>{c.text}</span>
                                    <span className="text-[9px] text-purple-400/50 ml-2">{c.style}</span>
                                  </button>
                                ))}
                              </div>
                            )}
                            {aiSuggestions.type === "send_time" && (
                              <div className="space-y-1">
                                {((aiSuggestions.data as { suggestions: { day: string; time: string; reason: string; score: number }[]; bestWindow: string }).suggestions || []).map((s, i) => (
                                  <div key={i} className="flex items-center justify-between text-[11px] text-purple-200 px-2 py-1.5 rounded-md bg-purple-500/5">
                                    <div>
                                      <span className="font-medium">{s.day} {s.time}</span>
                                      <span className="text-[9px] text-purple-400/50 ml-2">{s.reason}</span>
                                    </div>
                                    <span className="text-[9px] font-medium text-purple-400">{s.score}%</span>
                                  </div>
                                ))}
                                {(aiSuggestions.data as { bestWindow?: string }).bestWindow && (
                                  <div className="text-[10px] text-purple-400/70 px-2 pt-1">
                                    Best window: {(aiSuggestions.data as { bestWindow: string }).bestWindow}
                                  </div>
                                )}
                              </div>
                            )}
                            {aiSuggestions.type === "channels" && (
                              <div className="space-y-1">
                                {(aiSuggestions.data as { channel: string; reason: string; priority: string }[]).map((ch, i) => (
                                  <div key={i} className="flex items-center justify-between text-[11px] text-purple-200 px-2 py-1.5 rounded-md bg-purple-500/5">
                                    <div>
                                      <span className="font-medium capitalize">{ch.channel}</span>
                                      <span className="text-[9px] text-purple-400/50 ml-2">{ch.reason}</span>
                                    </div>
                                    <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${ch.priority === "primary" ? "bg-emerald-500/20 text-emerald-400" : "bg-blue-500/20 text-blue-400"}`}>
                                      {ch.priority}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                            {aiSuggestions.type === "preview_text" && (
                              <div className="space-y-1">
                                {(aiSuggestions.data as { text: string; approach: string; charCount: number }[]).map((p, i) => (
                                  <button key={i} onClick={() => { setPreviewText(p.text); setAiSuggestions(null); toast.success("Preview text applied"); }} className="flex items-center justify-between w-full text-left text-[11px] text-purple-200 px-2 py-1.5 rounded-md hover:bg-purple-500/15 transition-colors">
                                    <span className="flex-1 truncate">{p.text}</span>
                                    <span className="text-[9px] text-purple-400/50 ml-2 shrink-0">{p.approach} · {p.charCount}ch</span>
                                  </button>
                                ))}
                              </div>
                            )}
                            {aiSuggestions.type === "audience" && (
                              <div className="space-y-1">
                                {((aiSuggestions.data as { segments: { name: string; description: string; reason: string; expectedImpact: string; estimatedReach: string }[]; primarySegment: string }).segments || []).map((seg, i) => (
                                  <div key={i} className="text-[11px] text-purple-200 px-2 py-1.5 rounded-md bg-purple-500/5 space-y-0.5">
                                    <div className="flex items-center justify-between">
                                      <span className="font-medium">{seg.name}</span>
                                      <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${seg.expectedImpact === "high" ? "bg-emerald-500/20 text-emerald-400" : seg.expectedImpact === "medium" ? "bg-amber-500/20 text-amber-400" : "bg-muted/20 text-muted-foreground"}`}>
                                        {seg.expectedImpact} impact
                                      </span>
                                    </div>
                                    <p className="text-[9px] text-purple-400/60">{seg.description}</p>
                                    <p className="text-[9px] text-purple-400/50">{seg.reason}</p>
                                  </div>
                                ))}
                                {(aiSuggestions.data as { primarySegment?: string }).primarySegment && (
                                  <div className="text-[10px] text-purple-400/70 px-2 pt-1">
                                    Primary: {(aiSuggestions.data as { primarySegment: string }).primarySegment}
                                  </div>
                                )}
                              </div>
                            )}
                            {aiSuggestions.type === "ideas" && (
                              <div className="space-y-1">
                                {(aiSuggestions.data as { title: string; brief: string; contentType: string; category: string; effort: string; dataSource?: string }[]).map((idea, i) => (
                                  <button key={i} onClick={() => { setBody(idea.brief); setSubject(idea.title); setAiSuggestions(null); toast.success("Idea loaded as draft"); }} className="block w-full text-left text-[11px] text-purple-200 px-2 py-1.5 rounded-md hover:bg-purple-500/15 transition-colors space-y-0.5">
                                    <div className="flex items-center justify-between">
                                      <span className="font-medium">{idea.title}</span>
                                      <span className="text-[9px] text-purple-400/50">{idea.dataSource ? `${idea.dataSource} · ` : ''}{idea.category} · {idea.effort}</span>
                                    </div>
                                    <p className="text-[9px] text-purple-400/60">{idea.brief}</p>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {(contentType === "email" || contentType === "multi") && (
                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      placeholder="Email subject line..."
                      className="w-full px-3 py-2 rounded-lg bg-muted/10 border border-border/30 text-sm focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50 placeholder:text-muted-foreground/50"
                    />
                    <input
                      type="text"
                      value={previewText}
                      onChange={(e) => setPreviewText(e.target.value)}
                      placeholder="Preview text (preheader)..."
                      className="w-full px-3 py-1.5 rounded-lg bg-muted/5 border border-border/20 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50 placeholder:text-muted-foreground/40"
                    />
                  </div>
                )}

                <div className="relative">
                  <textarea
                    ref={textareaRef}
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    rows={8}
                    placeholder={contentType === "email" ? "Write your email content..." : "What do you want to share with your audience?"}
                    className="w-full px-3 py-3 rounded-xl bg-muted/10 border border-border/30 text-sm resize-none focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50 placeholder:text-muted-foreground/50 leading-relaxed"
                  />
                  <div className="absolute bottom-2 right-2 flex items-center gap-2">
                    {maxChars > 0 && (
                      <span className={`text-[10px] ${charCount > maxChars ? "text-red-400" : "text-muted-foreground/50"}`}>
                        {charCount}/{maxChars}
                      </span>
                    )}
                  </div>
                </div>

                {mediaUrls.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {mediaUrls.map((url, i) => (
                      <div key={i} className="relative group w-16 h-16 rounded-lg overflow-hidden border border-border/30">
                        <Image src={url} alt={`Media ${i + 1}`} className="w-full h-full object-cover"  fill sizes="(max-width: 768px) 100vw, 50vw" unoptimized />
                        <button
                          onClick={() => removeMedia(i)}
                          className="absolute top-0.5 right-0.5 p-0.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="hidden"
                    onChange={(e) => { if (e.target.files) { void handleMediaUpload(e.target.files); } e.target.value = ""; }}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/30 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/15 transition-colors disabled:opacity-40"
                  >
                    {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ImagePlus className="w-3.5 h-3.5" />}
                    {uploading ? "Uploading..." : "Add Media"}
                  </button>
                  {contentType === "social" && mediaUrls.length === 0 && (
                    <span className="text-[10px] text-muted-foreground/60 flex items-center gap-1">
                      <ImageIcon className="w-3 h-3" /> Posts with images get 2.3x more engagement
                    </span>
                  )}
                  <div className="flex-1" />
                  <button
                    onClick={handleSaveDraft}
                    disabled={saving || !body.trim()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground border border-border/30 hover:bg-muted/15 transition-colors disabled:opacity-40"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Save Draft
                  </button>
                  <button
                    onClick={() => { if (canAdvanceToDistribute) setStep("distribute"); }}
                    disabled={!canAdvanceToDistribute}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:bg-[hsl(var(--kf-accent1))]/90 transition-colors disabled:opacity-40"
                  >
                    Next: Distribute <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            )}

            {step === "distribute" && (
              <motion.div key="distribute" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
                <ChannelSelector
                  businessId={businessId}
                  selectedDestinations={selectedDestinations}
                  onSelectionChange={handleDestinationChange}
                  contentType={contentTypeForApi}
                  healthData={healthData}
                />

                {channelWarnings.length > 0 && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-400">Channel Compatibility</span>
                    </div>
                    {channelWarnings.map((w, i) => (
                      <div key={i} className="flex items-center gap-2 text-[11px]">
                        {w.severity === "error" ? (
                          <AlertCircle className="w-3 h-3 text-red-400 shrink-0" />
                        ) : (
                          <AlertTriangle className="w-3 h-3 text-amber-400 shrink-0" />
                        )}
                        <span className={w.severity === "error" ? "text-red-400" : "text-amber-400/80"}>
                          <span className="font-medium">{w.platform}:</span> {w.message}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {selectedDestinations.length > 0 && (
                  <ChannelVariantsPanel
                    masterBody={body}
                    masterSubject={subject}
                    selectedDestinations={selectedDestinations}
                    variants={variants}
                    onVariantsChange={setVariants}
                  />
                )}

                {selectedDestinations.length > 0 && selectedDestinations.some(d => {
                  const p = d.platform.toUpperCase();
                  return p === "EMAIL" || p === "GOOGLE" || p === "WHATSAPP";
                }) && (
                  <AudienceSelector
                    businessId={businessId}
                    subject={subject}
                    destinationIds={selectedDestinations.map(d => d.id)}
                    selectedTags={segmentTags}
                    onTagsChange={setSegmentTags}
                    onValidationChange={setEmailValidation}
                    hasEmailDestination={hasEmailDestination}
                  />
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setStep("compose")}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground border border-border/30 hover:bg-muted/15 transition-colors"
                  >
                    Back
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={() => { if (canAdvanceToReview) setStep("review"); }}
                    disabled={!canAdvanceToReview}
                    className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-medium bg-[hsl(var(--kf-accent1))] text-white hover:bg-[hsl(var(--kf-accent1))]/90 transition-colors disabled:opacity-40"
                  >
                    Next: Review <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            )}

            {step === "review" && (
              <motion.div key="review" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} className="space-y-4">
                {(hasBlockingWarnings || hasEmailValidationErrors) && (
                  <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-red-400">Cannot Publish</span>
                    </div>
                    {channelWarnings.filter((w) => w.severity === "error").map((w, i) => (
                      <p key={i} className="text-[11px] text-red-400/80 ml-5">{w.platform}: {w.message}</p>
                    ))}
                    {emailValidation?.warnings.filter((w) => w.severity === "error").map((w, i) => (
                      <p key={`ev-${i}`} className="text-[11px] text-red-400/80 ml-5">Email: {w.message}</p>
                    ))}
                  </div>
                )}

                <div className="rounded-xl border border-border/30 bg-card p-4 space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <FileText className="w-4 h-4 text-muted-foreground" /> Content Summary
                  </h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground block text-[10px] mb-0.5">Type</span>
                      <span className="font-medium capitalize">{contentType === "multi" ? "Multi-Channel" : contentType}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground block text-[10px] mb-0.5">Channels</span>
                      <span className="font-medium">{selectedDestinations.length} destination{selectedDestinations.length !== 1 ? "s" : ""}</span>
                    </div>
                    {hasEmailDestination && emailValidation && (
                      <div>
                        <span className="text-muted-foreground block text-[10px] mb-0.5">Email Recipients</span>
                        <span className="font-medium">{emailValidation.audienceSummary.eligible} eligible{segmentTags.length > 0 ? ` (${segmentTags.join(", ")})` : ""}</span>
                      </div>
                    )}
                    {objective && (
                      <div>
                        <span className="text-muted-foreground block text-[10px] mb-0.5">Objective</span>
                        <span className="font-medium capitalize">{objective.replace(/_/g, " ")}</span>
                      </div>
                    )}
                    {tone && (
                      <div>
                        <span className="text-muted-foreground block text-[10px] mb-0.5">Tone</span>
                        <span className="font-medium capitalize">{tone}</span>
                      </div>
                    )}
                  </div>
                  {subject && (
                    <div className="text-xs">
                      <span className="text-muted-foreground block text-[10px] mb-0.5">Subject</span>
                      <span className="font-medium">{subject}</span>
                    </div>
                  )}
                  <div className="text-xs">
                    <span className="text-muted-foreground block text-[10px] mb-0.5">Content</span>
                    <p className="text-foreground/80 line-clamp-3">{body}</p>
                  </div>
                  {mediaUrls.length > 0 && (
                    <div className="text-xs">
                      <span className="text-muted-foreground block text-[10px] mb-0.5">Media</span>
                      <div className="flex gap-1.5 mt-1">
                        {mediaUrls.map((url, i) => (
                          <Image key={i} src={url} alt="" className="w-10 h-10 rounded object-cover border border-border/20"  width={40} height={40} unoptimized />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-border/30 bg-card p-4 space-y-3">
                  <h4 className="text-sm font-semibold flex items-center gap-2">
                    <Clock className="w-4 h-4 text-muted-foreground" /> Delivery
                  </h4>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setScheduleMode("now")}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                        scheduleMode === "now"
                          ? "bg-[hsl(var(--kf-accent1))]/15 text-[hsl(var(--kf-accent1))] border border-[hsl(var(--kf-accent1))]/30"
                          : "border border-border/30 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Send className="w-3.5 h-3.5" /> Publish Now
                    </button>
                    <button
                      onClick={() => setScheduleMode("later")}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
                        scheduleMode === "later"
                          ? "bg-[hsl(var(--kf-accent2))]/15 text-[hsl(var(--kf-accent2))] border border-[hsl(var(--kf-accent2))]/30"
                          : "border border-border/30 text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <Calendar className="w-3.5 h-3.5" /> Schedule
                    </button>
                  </div>
                  {scheduleMode === "later" && (
                    <div className="space-y-2">
                      <input
                        type="datetime-local"
                        value={scheduledAt}
                        onChange={(e) => setScheduledAt(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-muted/10 border border-border/30 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent2))]/50"
                      />
                      <select
                        value={timezone}
                        onChange={(e) => setTimezone(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg bg-transparent border border-border/30 text-xs focus:outline-none focus:border-[hsl(var(--kf-accent2))]/50"
                      >
                        {TIMEZONES.map((tz) => (
                          <option key={tz.value} value={tz.value}>{tz.label}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-border/30 bg-card p-4 space-y-2">
                  <h4 className="text-sm font-semibold">Distribution Targets</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {selectedDestinations.map((dest) => (
                      <span key={dest.id} className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted/15 text-[10px] font-medium border border-border/20">
                        <CheckCircle className="w-3 h-3 text-emerald-400" />
                        {dest.displayName}
                      </span>
                    ))}
                  </div>
                  {variants.filter((v) => v.customized).length > 0 && (
                    <p className="text-[10px] text-[hsl(var(--kf-accent2))]">
                      {variants.filter((v) => v.customized).length} channel{variants.filter((v) => v.customized).length > 1 ? "s" : ""} with custom content
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setStep("distribute")}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs text-muted-foreground hover:text-foreground border border-border/30 hover:bg-muted/15 transition-colors"
                  >
                    Back
                  </button>
                  <div className="flex-1" />
                  <button
                    onClick={handlePublish}
                    disabled={publishing || !canPublish || (scheduleMode === "later" && !scheduledAt)}
                    className="flex items-center gap-1.5 px-5 py-2 rounded-lg text-sm font-semibold bg-[hsl(var(--kf-accent1))] text-white hover:bg-[hsl(var(--kf-accent1))]/90 transition-colors disabled:opacity-40 shadow-lg shadow-[hsl(var(--kf-accent1))]/20"
                  >
                    {publishing ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Processing...</>
                    ) : scheduleMode === "later" ? (
                      <><Clock className="w-4 h-4" /> Schedule Delivery</>
                    ) : (
                      <><Send className="w-4 h-4" /> Publish Now</>
                    )}
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {showPreview && (
          <div className="hidden lg:block">
            <ChannelPreviewPanel
              body={body}
              subject={subject}
              mediaUrls={mediaUrls}
              selectedPlatforms={selectedPlatforms.length > 0 ? selectedPlatforms : ["GENERIC"]}
              businessName={businessName}
              variants={variants}
            />
          </div>
        )}
      </div>
    </div>
  );
}
