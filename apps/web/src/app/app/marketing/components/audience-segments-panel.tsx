"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Users, Tag, ArrowRight, Search, RefreshCw, Mail, PenSquare, TrendingUp } from "lucide-react";
import { fetchContacts } from "@/lib/client";
import { useRouter } from "next/navigation";
import { CONTACT_AGE_GROUPS, getContactAgeGroupLabel } from "@/lib/crm-constants";

interface ContactSegment {
  tag: string;
  count: number;
}

interface AgeGroupSegment {
  ageGroup: string;
  count: number;
}

interface AudienceSegmentsPanelProps {
  businessId: string | null;
  onCreateCampaign?: () => void;
  onCreatePost?: () => void;
}

export function AudienceSegmentsPanel({ businessId, onCreateCampaign, onCreatePost }: AudienceSegmentsPanelProps) {
  const router = useRouter();
  const [segments, setSegments] = useState<ContactSegment[]>([]);
  const [ageGroupSegments, setAgeGroupSegments] = useState<AgeGroupSegment[]>([]);
  const [selectedAgeGroups, setSelectedAgeGroups] = useState<Set<string>>(new Set());
  const [totalContacts, setTotalContacts] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [hoveredTag, setHoveredTag] = useState<string | null>(null);

  const loadSegments = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetchContacts(businessId, { take: 500 });
      if (res.data?.contacts) {
        const contacts = res.data.contacts;
        setTotalContacts(contacts.length);
        const tagCounts: Record<string, number> = {};
        const ageCounts: Record<string, number> = {};
        contacts.forEach((c: { tags?: string[]; ageGroup?: string | null }) => {
          if (c.tags && c.tags.length > 0) {
            c.tags.forEach((t) => {
              tagCounts[t] = (tagCounts[t] || 0) + 1;
            });
          }
          const ag = c.ageGroup ?? "UNKNOWN";
          ageCounts[ag] = (ageCounts[ag] || 0) + 1;
        });
        const segs = Object.entries(tagCounts)
          .map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count);
        setSegments(segs);
        const ageSegs = Object.entries(ageCounts)
          .map(([ageGroup, count]) => ({ ageGroup, count }))
          .sort((a, b) => b.count - a.count);
        setAgeGroupSegments(ageSegs);
      }
    } catch {}
    setLoading(false);
  }, [businessId]);

  const toggleAgeGroup = useCallback((group: string) => {
    setSelectedAgeGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs external or derived state into local component state
    void loadSegments();
  }, [loadSegments]);

  const filtered = useMemo(() => {
    if (!search.trim()) return segments;
    const q = search.toLowerCase();
    return segments.filter((s) => s.tag.toLowerCase().includes(q));
  }, [segments, search]);

  const untaggedCount = useMemo(() => {
    const taggedTotal = segments.reduce((sum, s) => sum + s.count, 0);
    return Math.max(0, totalContacts - taggedTotal);
  }, [segments, totalContacts]);

  const handleViewSegment = (tag: string) => {
    router.push(`/app/crm?filter=tag:${encodeURIComponent(tag)}`);
  };

  const handleViewAgeGroup = (group: string) => {
    router.push(`/app/crm?filter=ageGroup:${encodeURIComponent(group)}`);
  };

  if (loading) {
    return (
      <div className="kf-card p-6 text-center">
        <RefreshCw className="w-5 h-5 text-muted-foreground animate-spin mx-auto mb-2" />
        <p className="text-xs text-muted-foreground">Loading contact segments...</p>
      </div>
    );
  }

  return (
    <div className="kf-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
          <h3 className="text-sm font-semibold">Contact Segments</h3>
        </div>
        <span className="text-xs text-muted-foreground">{totalContacts} total contacts</span>
      </div>

      {segments.length > 5 && (
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter segments..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md bg-muted/30 border border-border/30 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      )}

      {filtered.length === 0 && segments.length === 0 ? (
        <div className="py-6 text-center">
          <Tag className="w-6 h-6 text-muted-foreground/30 mx-auto mb-2" />
          <p className="text-xs text-muted-foreground">No segments yet</p>
          <p className="text-xs text-muted-foreground/60 mt-1">Tag contacts in CRM to create audience segments for targeted campaigns</p>
        </div>
      ) : (
        <div className="space-y-1 max-h-[280px] overflow-y-auto">
          {filtered.map((seg) => {
            const pct = totalContacts > 0 ? Math.round((seg.count / totalContacts) * 100) : 0;
            return (
              <div
                key={seg.tag}
                className="relative group"
                onMouseEnter={() => setHoveredTag(seg.tag)}
                onMouseLeave={() => setHoveredTag(null)}
              >
                <button
                  onClick={() => handleViewSegment(seg.tag)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-muted/30 transition-colors"
                >
                  <Tag className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                  <span className="text-xs font-medium flex-1 truncate">{seg.tag}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-12 h-1 rounded-full bg-border/20 overflow-hidden">
                      <div className="h-full rounded-full bg-[hsl(var(--kf-accent2))]" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums w-8 text-right">{seg.count}</span>
                  </div>
                  <ArrowRight className="w-3 h-3 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
                </button>
                {hoveredTag === seg.tag && (onCreateCampaign || onCreatePost) && (
                  <div className="absolute right-10 top-1/2 -translate-y-1/2 flex items-center gap-1 z-10">
                    {onCreateCampaign && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onCreateCampaign(); }}
                        className="p-1 rounded bg-blue-500/10 hover:bg-blue-500/20 transition-colors"
                        title={`Campaign for ${seg.tag}`}
                      >
                        <Mail className="w-3 h-3 text-blue-400" />
                      </button>
                    )}
                    {onCreatePost && (
                      <button
                        onClick={(e) => { e.stopPropagation(); onCreatePost(); }}
                        className="p-1 rounded bg-[hsl(var(--kf-accent2))]/10 hover:bg-[hsl(var(--kf-accent2))]/20 transition-colors"
                        title={`Post for ${seg.tag}`}
                      >
                        <PenSquare className="w-3 h-3 text-[hsl(var(--kf-accent2))]" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {untaggedCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground/60">
              <Users className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="text-xs flex-1">Untagged</span>
              <span className="text-xs tabular-nums">{untaggedCount}</span>
            </div>
          )}
        </div>
      )}

      {ageGroupSegments.length > 0 && (
        <div className="pt-2 border-t border-border/20 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Users className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">Age groups</span>
            </div>
            {selectedAgeGroups.size > 0 && (
              <button
                onClick={() => setSelectedAgeGroups(new Set())}
                className="text-[10px] text-amber-400 hover:text-amber-300 transition-colors"
              >
                Clear
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1">
            {[...CONTACT_AGE_GROUPS, "UNKNOWN"].map((group) => {
              const seg = ageGroupSegments.find((s) => s.ageGroup === group);
              if (!seg) return null;
              const isSelected = selectedAgeGroups.has(group);
              const label = group === "UNKNOWN" ? "Unknown" : getContactAgeGroupLabel(group);
              return (
                <button
                  key={group}
                  onClick={() => toggleAgeGroup(group)}
                  onDoubleClick={() => group !== "UNKNOWN" && handleViewAgeGroup(group)}
                  className={`text-[10px] px-2 py-1 rounded-lg border transition-colors ${
                    isSelected
                      ? "bg-[hsl(var(--kf-accent2))]/15 border-[hsl(var(--kf-accent2))]/30 text-[hsl(var(--kf-accent2))]"
                      : "bg-muted/10 border-border/30 text-muted-foreground hover:text-foreground hover:bg-muted/20"
                  }`}
                  title={`${label} — ${seg.count} contact${seg.count !== 1 ? "s" : ""}`}
                >
                  {label} <span className="opacity-60 tabular-nums">({seg.count})</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {segments.length > 0 && (
        <div className="flex items-center gap-1.5 pt-1 border-t border-border/20">
          <TrendingUp className="w-3 h-3 text-muted-foreground/40" />
          <span className="text-[10px] text-muted-foreground/40">{segments.length} segment{segments.length > 1 ? "s" : ""} across {totalContacts} contacts</span>
        </div>
      )}
    </div>
  );
}
