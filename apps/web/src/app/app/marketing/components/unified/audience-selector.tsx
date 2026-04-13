"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  Users, Tag, Search, ChevronDown, ChevronUp, AlertTriangle,
  CheckCircle, ShieldOff, Mail, RefreshCw,
} from "lucide-react";
import { expandAudience, validateEmailSend } from "@/lib/client";
import type { EmailValidationResult, AudienceExpandResult } from "@/lib/client";

interface AudienceSelectorProps {
  businessId: string;
  subject: string;
  destinationIds: string[];
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  onValidationChange?: (result: EmailValidationResult | null) => void;
}

export function AudienceSelector({
  businessId,
  subject,
  destinationIds,
  selectedTags,
  onTagsChange,
  onValidationChange,
}: AudienceSelectorProps) {
  const [audienceData, setAudienceData] = useState<AudienceExpandResult | null>(null);
  const [validation, setValidation] = useState<EmailValidationResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [validating, setValidating] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [tagSearch, setTagSearch] = useState("");

  const loadAudience = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await expandAudience({ segmentTags: selectedTags.length > 0 ? selectedTags : undefined, limit: 500 }, businessId);
      if (res.data) setAudienceData(res.data);
    } catch {}
    setLoading(false);
  }, [businessId, selectedTags]);

  const runValidation = useCallback(async () => {
    if (!businessId) return;
    setValidating(true);
    try {
      const res = await validateEmailSend({ subject, destinationIds, segmentTags: selectedTags.length > 0 ? selectedTags : undefined }, businessId);
      if (res.data) {
        setValidation(res.data);
        onValidationChange?.(res.data);
      }
    } catch {}
    setValidating(false);
  }, [businessId, subject, destinationIds, selectedTags, onValidationChange]);

  useEffect(() => { void loadAudience(); }, [loadAudience]);

  useEffect(() => {
    const timeout = setTimeout(() => { void runValidation(); }, 500);
    return () => clearTimeout(timeout);
  }, [subject, selectedTags, destinationIds, runValidation]);

  const filteredTags = useMemo(() => {
    if (!audienceData?.availableTags) return [];
    if (!tagSearch.trim()) return audienceData.availableTags;
    const q = tagSearch.toLowerCase();
    return audienceData.availableTags.filter((t) => t.toLowerCase().includes(q));
  }, [audienceData?.availableTags, tagSearch]);

  const toggleTag = (tag: string) => {
    onTagsChange(
      selectedTags.includes(tag)
        ? selectedTags.filter((t) => t !== tag)
        : [...selectedTags, tag],
    );
  };

  const errors = validation?.warnings.filter((w) => w.severity === "error") ?? [];
  const warnings = validation?.warnings.filter((w) => w.severity === "warning") ?? [];

  return (
    <div className="rounded-xl border border-border/30 bg-card overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/10 transition-colors"
      >
        <Users className="w-4 h-4 text-[hsl(var(--kf-accent2))]" />
        <div className="flex-1 min-w-0 text-left">
          <p className="text-xs font-medium">Audience & Segments</p>
          {validation && (
            <p className="text-[10px] text-muted-foreground">
              {validation.audienceSummary.eligible} eligible recipient{validation.audienceSummary.eligible !== 1 ? "s" : ""}
              {validation.audienceSummary.suppressed > 0 && (
                <span className="text-amber-400 ml-1">({validation.audienceSummary.suppressed} suppressed)</span>
              )}
            </p>
          )}
        </div>
        {validation?.valid ? (
          <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
        ) : validation ? (
          <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
        ) : null}
        {expanded ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground" /> : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2.5 border-t border-border/20 pt-2">
          <div className="flex items-center gap-2">
            <Tag className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground">Filter by segment tags (optional)</span>
          </div>

          {audienceData && audienceData.availableTags.length > 5 && (
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <input
                type="text"
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
                placeholder="Search tags..."
                className="w-full pl-7 pr-3 py-1.5 text-[10px] rounded-lg bg-muted/10 border border-border/30 focus:outline-none focus:border-[hsl(var(--kf-accent1))]/50"
              />
            </div>
          )}

          {loading ? (
            <div className="flex items-center gap-2 py-2">
              <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin" />
              <span className="text-[10px] text-muted-foreground">Loading audience...</span>
            </div>
          ) : (
            <div className="flex flex-wrap gap-1 max-h-[120px] overflow-y-auto">
              {filteredTags.map((tag) => {
                const isSelected = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`text-[10px] px-2 py-1 rounded-lg border transition-colors ${
                      isSelected
                        ? "bg-[hsl(var(--kf-accent2))]/15 border-[hsl(var(--kf-accent2))]/30 text-[hsl(var(--kf-accent2))]"
                        : "bg-muted/10 border-border/30 text-muted-foreground hover:text-foreground hover:bg-muted/20"
                    }`}
                  >
                    {tag}
                  </button>
                );
              })}
              {filteredTags.length === 0 && !loading && (
                <span className="text-[10px] text-muted-foreground/50 py-2">No tags found</span>
              )}
            </div>
          )}

          {selectedTags.length > 0 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => onTagsChange([])}
                className="text-[10px] text-amber-400 hover:text-amber-300 transition-colors"
              >
                Clear all
              </button>
            </div>
          )}

          {validation && (
            <div className="space-y-1.5 pt-1 border-t border-border/20">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Mail className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">Pre-send check</span>
                </div>
                {validating && <RefreshCw className="w-3 h-3 text-muted-foreground animate-spin" />}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="text-center px-2 py-1.5 rounded-lg bg-muted/10">
                  <p className="text-sm font-semibold tabular-nums">{validation.audienceSummary.totalMatching}</p>
                  <p className="text-[9px] text-muted-foreground">Matching</p>
                </div>
                <div className="text-center px-2 py-1.5 rounded-lg bg-muted/10">
                  <p className="text-sm font-semibold tabular-nums text-emerald-400">{validation.audienceSummary.eligible}</p>
                  <p className="text-[9px] text-muted-foreground">Eligible</p>
                </div>
                <div className="text-center px-2 py-1.5 rounded-lg bg-muted/10">
                  <p className={`text-sm font-semibold tabular-nums ${validation.audienceSummary.suppressed > 0 ? "text-amber-400" : ""}`}>{validation.audienceSummary.suppressed}</p>
                  <p className="text-[9px] text-muted-foreground">Suppressed</p>
                </div>
              </div>

              {errors.length > 0 && (
                <div className="space-y-1">
                  {errors.map((e, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[10px] text-red-400">
                      <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                      <span>{e.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {warnings.length > 0 && (
                <div className="space-y-1">
                  {warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-[10px] text-amber-400">
                      <ShieldOff className="w-3 h-3 shrink-0 mt-0.5" />
                      <span>{w.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {!validation.senderConfigured && (
                <div className="flex items-start gap-1.5 text-[10px] text-red-400 pt-1">
                  <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" />
                  <span>No email sender configured. Set up your sender identity in Content Studio first.</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
