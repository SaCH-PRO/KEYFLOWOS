"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { Eye, Mail, Facebook, Instagram, MessageCircle, Globe, Smartphone } from "lucide-react";

type PreviewPlatform = "FACEBOOK" | "INSTAGRAM" | "EMAIL" | "WHATSAPP" | "GENERIC";

interface ChannelPreviewPanelProps {
  body: string;
  subject?: string;
  mediaUrls?: string[];
  selectedPlatforms: PreviewPlatform[];
  businessName?: string;
}

const PLATFORM_META: Record<PreviewPlatform, { label: string; icon: React.ElementType; color: string; bg: string }> = {
  FACEBOOK: { label: "Facebook", icon: Facebook, color: "#1877F2", bg: "rgba(24,119,242,0.08)" },
  INSTAGRAM: { label: "Instagram", icon: Instagram, color: "#E4405F", bg: "rgba(228,64,95,0.08)" },
  EMAIL: { label: "Email", icon: Mail, color: "#F97316", bg: "rgba(249,115,22,0.08)" },
  WHATSAPP: { label: "WhatsApp", icon: MessageCircle, color: "#25D366", bg: "rgba(37,211,102,0.08)" },
  GENERIC: { label: "Preview", icon: Globe, color: "#94a3b8", bg: "rgba(148,163,184,0.08)" },
};

function truncateText(text: string, max: number) {
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}

function stripHtml(html: string) {
  return html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
}

function FacebookPreview({ body, mediaUrls, businessName }: { body: string; mediaUrls?: string[]; businessName?: string }) {
  const plain = stripHtml(body);
  return (
    <div className="rounded-xl border border-border/30 bg-[#1a1a1e] overflow-hidden">
      <div className="p-3 flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-[#1877F2]/20 flex items-center justify-center">
          <span className="text-xs font-bold text-[#1877F2]">{(businessName || "B")[0]}</span>
        </div>
        <div>
          <p className="text-xs font-semibold">{businessName || "Your Business"}</p>
          <p className="text-[10px] text-muted-foreground">Just now · <Globe className="w-2.5 h-2.5 inline" /></p>
        </div>
      </div>
      <div className="px-3 pb-2">
        <p className="text-xs text-foreground/90 whitespace-pre-wrap leading-relaxed">{truncateText(plain, 400)}</p>
      </div>
      {mediaUrls && mediaUrls.length > 0 && (
        <div className="w-full aspect-video bg-muted/20 flex items-center justify-center border-t border-border/20">
          <img src={mediaUrls[0]} alt="" className="w-full h-full object-cover" />
        </div>
      )}
      <div className="px-3 py-2 border-t border-border/20 flex items-center gap-4 text-[10px] text-muted-foreground">
        <span>👍 Like</span><span>💬 Comment</span><span>↗ Share</span>
      </div>
    </div>
  );
}

function InstagramPreview({ body, mediaUrls, businessName }: { body: string; mediaUrls?: string[]; businessName?: string }) {
  const plain = stripHtml(body);
  return (
    <div className="rounded-xl border border-border/30 bg-[#1a1a1e] overflow-hidden">
      <div className="p-3 flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-[#F58529] via-[#DD2A7B] to-[#8134AF] flex items-center justify-center">
          <span className="text-[10px] font-bold text-white">{(businessName || "B")[0]}</span>
        </div>
        <p className="text-xs font-semibold">{businessName || "yourbusiness"}</p>
      </div>
      <div className="w-full aspect-square bg-muted/20 flex items-center justify-center">
        {mediaUrls && mediaUrls.length > 0 ? (
          <img src={mediaUrls[0]} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground/50">
            <Smartphone className="w-8 h-8" />
            <span className="text-[10px]">Add media for preview</span>
          </div>
        )}
      </div>
      <div className="px-3 py-2 text-[10px]">
        <span className="font-semibold mr-1">{businessName || "yourbusiness"}</span>
        <span className="text-foreground/80">{truncateText(plain, 200)}</span>
      </div>
    </div>
  );
}

function EmailPreview({ body, subject, businessName }: { body: string; subject?: string; businessName?: string }) {
  return (
    <div className="rounded-xl border border-border/30 bg-[#1a1a1e] overflow-hidden">
      <div className="p-3 border-b border-border/20 space-y-1">
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="font-medium text-foreground">From:</span>
          <span>{businessName || "Your Business"}</span>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
          <span className="font-medium text-foreground">Subject:</span>
          <span>{subject || "(No subject)"}</span>
        </div>
      </div>
      <div className="p-3 text-xs text-foreground/80 max-h-48 overflow-y-auto prose-sm" dangerouslySetInnerHTML={{ __html: body || "<p>Start writing your email...</p>" }} />
    </div>
  );
}

function WhatsAppPreview({ body, mediaUrls }: { body: string; mediaUrls?: string[] }) {
  const plain = stripHtml(body);
  return (
    <div className="rounded-xl border border-border/30 bg-[#1a1a1e] overflow-hidden p-3">
      <div className="bg-[#005C4B]/20 rounded-lg p-3 max-w-[85%] ml-auto">
        {mediaUrls && mediaUrls.length > 0 && (
          <img src={mediaUrls[0]} alt="" className="w-full rounded-md mb-2 max-h-36 object-cover" />
        )}
        <p className="text-xs text-foreground/90 whitespace-pre-wrap">{truncateText(plain, 300)}</p>
        <p className="text-[9px] text-muted-foreground text-right mt-1">Now ✓✓</p>
      </div>
    </div>
  );
}

export function ChannelPreviewPanel({ body, subject, mediaUrls, selectedPlatforms, businessName }: ChannelPreviewPanelProps) {
  const platforms = useMemo(() => {
    if (selectedPlatforms.length === 0) return ["GENERIC" as PreviewPlatform];
    return selectedPlatforms;
  }, [selectedPlatforms]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <Eye className="w-3.5 h-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">Live Preview</span>
      </div>
      <div className="space-y-3">
        {platforms.map((platform) => {
          const meta = PLATFORM_META[platform] || PLATFORM_META.GENERIC;
          const Icon = meta.icon;
          return (
            <motion.div key={platform} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 px-1">
                  <Icon className="w-3 h-3" style={{ color: meta.color }} />
                  <span className="text-[10px] font-medium" style={{ color: meta.color }}>{meta.label}</span>
                </div>
                {platform === "FACEBOOK" && <FacebookPreview body={body} mediaUrls={mediaUrls} businessName={businessName} />}
                {platform === "INSTAGRAM" && <InstagramPreview body={body} mediaUrls={mediaUrls} businessName={businessName} />}
                {platform === "EMAIL" && <EmailPreview body={body} subject={subject} businessName={businessName} />}
                {platform === "WHATSAPP" && <WhatsAppPreview body={body} mediaUrls={mediaUrls} />}
                {platform === "GENERIC" && <FacebookPreview body={body} mediaUrls={mediaUrls} businessName={businessName} />}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
