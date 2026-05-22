"use client";

import { useState, useCallback, useEffect } from "react";
import { Globe, CheckCircle2, Loader2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { updateStorefrontConfig } from "@/lib/client";

interface Props {
  businessId: string;
  domain: string;
  onChange?: (domain: string) => void;
}

export function CustomDomainPanel({ businessId, domain: initialDomain, onChange }: Props) {
  const [domain, setDomain] = useState(initialDomain);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setDomain(initialDomain);
  }, [initialDomain]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    const cleaned = domain.trim().toLowerCase();
    const res = await updateStorefrontConfig(businessId, { customDomain: cleaned || undefined });
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
      return;
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    toast.success("Custom domain saved");
  }, [businessId, domain]);

  const isValid = !domain || /^[a-z0-9][a-z0-9-]*\.[a-z]{2,}$/i.test(domain.trim());

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex-1">
          <label className="text-xs text-muted-foreground mb-1 block">Custom Domain</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={domain}
              onChange={(e) => { setDomain(e.target.value); onChange?.(e.target.value); }}
              placeholder="e.g. shop.yourdomain.com"
              className="flex-1 rounded-lg border border-border/40 bg-background px-3 py-2 text-sm"
            />
            <button
              onClick={handleSave}
              disabled={saving || !isValid}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary text-primary-foreground px-3 py-2 text-xs font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 min-w-[80px] justify-center"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <CheckCircle2 className="w-3.5 h-3.5" /> : "Save"}
            </button>
          </div>
          {!isValid && domain.trim() && (
            <p className="text-[11px] text-rose-500 mt-1">Enter a valid domain like shop.example.com</p>
          )}
        </div>
      </div>

      {domain.trim() && isValid && (
        <div className="rounded-xl border border-border/40 bg-card/40 p-3 space-y-2">
          <p className="text-xs font-medium flex items-center gap-1.5">
            <Globe className="w-3.5 h-3.5 text-muted-foreground" />
            DNS Setup Required
          </p>
          <p className="text-xs text-muted-foreground">
            Point your domain to KEYFLOWOS by adding a CNAME record:
          </p>
          <div className="rounded-lg bg-background/60 p-2 font-mono text-[11px] space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Type:</span>
              <span>CNAME</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Name:</span>
              <span>{domain.trim().split(".").slice(0, -2).join(".") || "@"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Target:</span>
              <span>custom.keyflowos.com</span>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Contact support after configuring DNS so we can provision the SSL certificate.
          </p>
        </div>
      )}

      <div className="flex items-start gap-2 text-[11px] text-muted-foreground">
        <ExternalLink className="w-3 h-3 mt-0.5 flex-shrink-0" />
        <span>Custom domains are available on the KeyFlow plan. Free plan users see a KEYFLOWOS-branded URL.</span>
      </div>
    </div>
  );
}
