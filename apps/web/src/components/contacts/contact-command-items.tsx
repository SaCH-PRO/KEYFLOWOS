"use client";

import { useEffect, useState } from "react";
import { Zap, Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchCommandItems, type CommandItem } from "@/lib/api/command";

interface ContactCommandItemsProps {
  contactId: string;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  OPEN: <Clock className="w-3 h-3 text-amber-500" />,
  IN_PROGRESS: <Loader2 className="w-3 h-3 text-blue-500 animate-spin" />,
  WAITING_APPROVAL: <Zap className="w-3 h-3 text-purple-500" />,
  EXECUTED: <CheckCircle2 className="w-3 h-3 text-emerald-500" />,
  COMPLETED: <CheckCircle2 className="w-3 h-3 text-emerald-500" />,
  DISMISSED: <XCircle className="w-3 h-3 text-muted-foreground" />,
};

const CATEGORY_COLORS: Record<string, string> = {
  MONEY: "bg-emerald-500/10 text-emerald-600",
  TIME: "bg-blue-500/10 text-blue-600",
  PEOPLE: "bg-amber-500/10 text-amber-600",
  WORK: "bg-purple-500/10 text-purple-600",
  SALES: "bg-pink-500/10 text-pink-600",
  MARKETING: "bg-orange-500/10 text-orange-600",
  GOVERNANCE: "bg-red-500/10 text-red-600",
  STRATEGY: "bg-indigo-500/10 text-indigo-600",
  SYSTEM: "bg-slate-500/10 text-slate-600",
};

export function ContactCommandItems({ contactId }: ContactCommandItemsProps) {
  const businessId = getStoredBusinessId() ?? "";
  const [items, setItems] = useState<CommandItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    async function load() {
      // Fetch command items where this contact is the owner
      const res = await fetchCommandItems(businessId, { ownerId: contactId, limit: 20 });
      if (cancelled) return;
      if (res.data) {
        setItems(res.data.items);
      }
      setLoading(false);
    }
    load();
    return () => { cancelled = true; };
  }, [businessId, contactId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-3">
        <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
        <span className="text-xs text-muted-foreground">Loading actions...</span>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="py-3 text-xs text-muted-foreground">
        No command items for this contact.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.id}
          className="flex items-start gap-2 p-2 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors"
        >
          <div className="mt-0.5">{STATUS_ICONS[item.status] ?? <Clock className="w-3 h-3 text-muted-foreground" />}</div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate">{item.title}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`text-[9px] px-1 py-0.5 rounded font-medium ${CATEGORY_COLORS[item.category] ?? "bg-muted text-muted-foreground"}`}>
                {item.category}
              </span>
              {item.priority > 70 && (
                <span className="text-[9px] text-red-500 font-medium">High priority</span>
              )}
              {item.expectedValue && (
                <span className="text-[9px] text-emerald-600 font-medium">
                  {item.currency} {Number(item.expectedValue).toLocaleString()}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
