"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  Circle,
  Building2,
  Wrench,
  Share2,
  ArrowRight,
  X,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  icon: React.ElementType;
  href: string;
  done: boolean;
}

interface GettingStartedChecklistProps {
  businessName?: string;
  hasBookings: boolean;
  onDismiss?: () => void;
}

interface SetupStatus {
  products?: boolean;
  businessHours?: boolean;
  contacts?: boolean;
  storefront?: boolean;
  profile?: boolean;
  completedCount?: number;
  totalSteps?: number;
  percentage?: number;
}

export function GettingStartedChecklist({
  businessName,
  hasBookings,
  onDismiss,
}: GettingStartedChecklistProps) {
  const [hasServices, setHasServices] = useState(false);
  const [hasContacts, setHasContacts] = useState(false);
  const [hasBusinessHours, setHasBusinessHours] = useState(false);
  const [storeEnabled, setStoreEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return false;
    return !!localStorage.getItem("kf_onboarding_dismissed");
  });
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    const biz = getStoredBusinessId();
    if (!biz) { setLoading(false); return; }
    const load = async () => {
      try {
        const res = await apiGet<SetupStatus>(`/onboarding-concierge/businesses/${biz}/status`);
        const s = res.data;
        setHasServices(!!s?.products);
        setHasContacts(!!s?.contacts);
        setHasBusinessHours(!!s?.businessHours);
        setStoreEnabled(!!s?.storefront);
      } catch {
        // Silently fail — checklist defaults to unchecked
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    localStorage.setItem("kf_onboarding_dismissed", "true");
    onDismiss?.();
  };

  const items: ChecklistItem[] = [
    {
      id: "business",
      label: "Set up your business",
      description: "Name, hours, and branding",
      icon: Building2,
      href: "/app/settings/business",
      done: !!businessName && hasBusinessHours,
    },
    {
      id: "services",
      label: "Add your first service",
      description: "What you offer and for how much",
      icon: Wrench,
      href: "/app/bookings?tab=catalog",
      done: hasServices,
    },
    {
      id: "contacts",
      label: "Add a contact",
      description: "Your first customer or lead",
      icon: Sparkles,
      href: "/app/network/contacts?action=new",
      done: hasContacts,
    },
    {
      id: "share",
      label: "Share your booking page",
      description: "Get your first booking",
      icon: Share2,
      href: "/app/bookings?action=share",
      done: hasBookings && storeEnabled,
    },
  ];

  const completedCount = items.filter((i) => i.done).length;
  const allDone = completedCount === items.length;

  if (loading) return null;
  if (dismissed || allDone) return null;

  return (
    <div className="kf-card kf-radius-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 kf-radius-md flex items-center justify-center"
            style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
          >
            <Sparkles className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold">Get started</h3>
            <p className="text-[11px] text-muted-foreground">
              {completedCount} of {items.length} completed
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <span className="text-xs font-medium">{expanded ? "Hide" : "Show"}</span>
          </button>
          <button
            onClick={handleDismiss}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            aria-label="Dismiss checklist"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="space-y-1 overflow-hidden"
          >
            {items.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 kf-radius-md transition-all ${
                  item.done
                    ? "opacity-50"
                    : "hover:bg-muted/50"
                }`}
              >
                {item.done ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                ) : (
                  <Circle className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${item.done ? "line-through" : ""}`}>
                    {item.label}
                  </p>
                  <p className="text-[11px] text-muted-foreground">{item.description}</p>
                </div>
                {!item.done && (
                  <ArrowRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                )}
              </Link>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
