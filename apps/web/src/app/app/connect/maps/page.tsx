"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Map as MapIcon,
  ExternalLink,
  Save,
  Trash2,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@keyflow/ui";
import { PageHeader } from "@/components/ui/page-header";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { apiPostSimple, apiDelete } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { BusinessAddressAutocomplete } from "@/components/ui/business-address-autocomplete";

export default function ConnectMapsPage() {
  const businessId = getStoredBusinessId();
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [testValue, setTestValue] = useState("");

  const handleSave = async () => {
    if (!businessId || !apiKey.trim()) return;
    setSaving(true);
    const res = await apiPostSimple(
      `/connect/businesses/${businessId}/maps/api-key`,
      { apiKey: apiKey.trim() },
    );
    setSaving(false);
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success("Maps API key saved");
      setSavedOnce(true);
      setApiKey("");
    }
  };

  const handleClear = async () => {
    if (!businessId) return;
    const res = await apiDelete(
      `/connect/businesses/${businessId}/maps/api-key`,
    );
    if (res.error) {
      toast.error(res.error);
    } else {
      toast.success("Maps API key cleared");
      setSavedOnce(false);
      setTestValue("");
    }
    setConfirmClear(false);
  };

  return (
    <div className="space-y-5 max-w-3xl mx-auto">
      <Link
        href="/app/connect"
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        Back to KeyFlow Connect
      </Link>
      <PageHeader
        icon={MapIcon}
        title="Google Maps"
        subtitle="Power address suggestions across booking, business profile and CRM with the Places API."
        rightSlot={
          <a
            href="https://console.cloud.google.com/google/maps-apis"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border/50 px-2 py-1 rounded-lg"
          >
            <ExternalLink className="h-3 w-3" />
            Cloud console
          </a>
        }
      />

      <section className="rounded-2xl border border-border/50 bg-card/40 p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold mb-1">API key</h3>
          <p className="text-xs text-muted-foreground">
            Paste a Google Maps API key with the <strong>Places API</strong> enabled.
            We store it encrypted on your business record.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="AIza…"
            className="flex-1 rounded-lg border border-border/60 bg-background/60 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[hsl(var(--kf-accent1)/0.5)]"
          />
          <Button
            onClick={handleSave}
            disabled={!apiKey.trim() || saving || !businessId}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save
          </Button>
          <Button
            variant="ghost"
            onClick={() => setConfirmClear(true)}
            disabled={saving || !businessId}
          >
            <Trash2 className="h-4 w-4 mr-2 text-red-400" />
            Clear
          </Button>
        </div>
        {savedOnce && (
          <p className="text-[11px] text-emerald-400 inline-flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Saved — try the test below.
          </p>
        )}
      </section>

      <section className="rounded-2xl border border-border/50 bg-card/40 p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold mb-1">Test address autocomplete</h3>
          <p className="text-xs text-muted-foreground">
            Start typing to see live predictions from your key.
          </p>
        </div>
        <BusinessAddressAutocomplete
          businessId={businessId}
          value={testValue}
          onChange={setTestValue}
          placeholder="Try: 123 Main Street, Port of Spain"
          onSelect={(p) => {
            toast.success(`Selected: ${p.formattedAddress}`);
          }}
        />
      </section>

      <ConfirmDialog
        open={confirmClear}
        title="Clear Maps API key"
        message="This will disable address autocomplete across the app until a new key is added."
        confirmLabel="Clear key"
        variant="danger"
        onConfirm={handleClear}
        onCancel={() => setConfirmClear(false)}
      />
    </div>
  );
}
