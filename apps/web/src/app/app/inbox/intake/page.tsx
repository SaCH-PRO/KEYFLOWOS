"use client";

import Link from "next/link";
import { ArrowLeft, Inbox, ShieldCheck, Loader2 } from "lucide-react";
import { getStoredBusinessId } from "@/lib/workspace";
import { apiGet, apiPatch } from "@/lib/api";
import { MessageIntakeQueue } from "./components/message-intake-queue";
import { Switch } from "@/components/ui/switch";
import { useEffect, useState } from "react";

export default function MessageIntakePage() {
  const businessId = getStoredBusinessId();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    apiGet<{ messageIntakeEnabled?: boolean }>(`/identity/businesses/${encodeURIComponent(businessId)}`)
      .then((res) => {
        setEnabled(res.data?.messageIntakeEnabled ?? false);
      })
      .catch(() => setEnabled(false));
  }, [businessId]);

  const toggle = async (checked: boolean) => {
    if (!businessId) return;
    setSaving(true);
    setEnabled(checked);
    await apiPatch(`/identity/businesses/${encodeURIComponent(businessId)}`, {
      messageIntakeEnabled: checked,
    });
    setSaving(false);
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto p-4">
      <div className="flex items-center gap-2">
        <Link
          href="/app/key-inbox"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Back to Inbox
        </Link>
      </div>
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-violet-500/20 to-rose-500/20 border border-border/40 flex items-center justify-center">
          <Inbox className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-semibold">Message Intake</h1>
          <p className="text-xs text-muted-foreground">
            Review and approve inbound messages before KEY creates threads, replies, and tasks.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border/50 bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="h-4 w-4 text-[hsl(var(--kf-accent1))] mt-0.5" />
            <div>
              <p className="text-sm font-medium">Approve messages before KEY responds</p>
              <p className="text-xs text-muted-foreground">
                When enabled, inbound messages land here as pending drafts. You approve each one
                before KEY sends a reply or takes any action.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {enabled === null || saving ? (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            ) : null}
            <Switch
              checked={enabled ?? false}
              onCheckedChange={toggle}
              disabled={enabled === null || saving}
              aria-label="Enable message intake"
            />
          </div>
        </div>
      </div>

      {businessId ? (
        <MessageIntakeQueue businessId={businessId} />
      ) : (
        <div className="text-sm text-muted-foreground">No active business — pick a workspace first.</div>
      )}
    </div>
  );
}
