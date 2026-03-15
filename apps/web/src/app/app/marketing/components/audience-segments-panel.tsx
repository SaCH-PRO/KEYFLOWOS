"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { Users, Tag, ArrowRight, Search, RefreshCw } from "lucide-react";
import { fetchContacts } from "@/lib/client";
import { useRouter } from "next/navigation";

interface ContactSegment {
  tag: string;
  count: number;
}

interface AudienceSegmentsPanelProps {
  businessId: string | null;
}

export function AudienceSegmentsPanel({ businessId }: AudienceSegmentsPanelProps) {
  const router = useRouter();
  const [segments, setSegments] = useState<ContactSegment[]>([]);
  const [totalContacts, setTotalContacts] = useState(0);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");

  const loadSegments = useCallback(async () => {
    if (!businessId) return;
    setLoading(true);
    try {
      const res = await fetchContacts(businessId, { take: 500 });
      if (res.data?.contacts) {
        const contacts = res.data.contacts;
        setTotalContacts(contacts.length);
        const tagCounts: Record<string, number> = {};
        contacts.forEach((c: { tags?: string[] }) => {
          if (c.tags && c.tags.length > 0) {
            c.tags.forEach((t) => {
              tagCounts[t] = (tagCounts[t] || 0) + 1;
            });
          }
        });
        const segs = Object.entries(tagCounts)
          .map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count);
        setSegments(segs);
      }
    } catch {}
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
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
          {filtered.map((seg) => (
            <button
              key={seg.tag}
              onClick={() => handleViewSegment(seg.tag)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-muted/30 transition-colors group"
            >
              <Tag className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
              <span className="text-xs font-medium flex-1 truncate">{seg.tag}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{seg.count}</span>
              <ArrowRight className="w-3 h-3 text-muted-foreground/0 group-hover:text-muted-foreground/60 transition-colors" />
            </button>
          ))}
          {untaggedCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 text-muted-foreground/60">
              <Users className="w-3.5 h-3.5 flex-shrink-0" />
              <span className="text-xs flex-1">Untagged</span>
              <span className="text-xs tabular-nums">{untaggedCount}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
