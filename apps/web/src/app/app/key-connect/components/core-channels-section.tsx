"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import {
  Facebook,
  Instagram,
  MessageCircle,
  Phone,
  Globe,
  Check,
  Loader2,
  ExternalLink,
} from "lucide-react";
import { apiPost } from "@/lib/api";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * Core Channels — the six surfaces every business needs connected first
 * (Google Suite, Facebook Page, Instagram, Messenger, WhatsApp, Website),
 * presented as one clear action row above the full integration directory.
 */

interface EntryHealth {
  status: string;
  connectedAccount?: string | null;
}
interface DashboardEntryLike {
  meta: { type: string; name: string };
  health: EntryHealth;
}

const GOOGLE_SERVICES = [
  { type: "gmail", label: "Gmail" },
  { type: "google_drive", label: "Drive" },
  { type: "google_calendar", label: "Calendar" },
  { type: "google_forms", label: "Forms" },
  { type: "google_contacts", label: "Contacts" },
  { type: "google_business_profile", label: "Business" },
] as const;

function StatusDot({ connected }: { connected: boolean }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        connected ? "bg-emerald-400" : "bg-zinc-500",
      )}
    />
  );
}

function ChannelCard({
  icon: Icon,
  title,
  subtitle,
  connected,
  account,
  actionLabel,
  onAction,
  busy,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  connected: boolean;
  account?: string | null;
  actionLabel: string;
  onAction: () => void;
  busy?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "rounded-2xl border p-4 flex flex-col gap-3 transition-colors",
        connected
          ? "border-emerald-500/30 bg-emerald-500/[0.04]"
          : "border-border/50 bg-card/60 hover:border-primary/25",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="h-9 w-9 shrink-0 rounded-xl bg-gradient-to-br from-primary/15 to-secondary/15 border border-border/40 flex items-center justify-center">
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h4 className="text-sm font-semibold truncate">{title}</h4>
              <StatusDot connected={connected} />
            </div>
            <p className="text-[11px] text-muted-foreground truncate">
              {connected && account ? account : subtitle}
            </p>
          </div>
        </div>
      </div>
      {children}
      <button
        type="button"
        onClick={onAction}
        disabled={busy}
        className={cn(
          "mt-auto inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all active:scale-95",
          connected
            ? "border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted/40"
            : "bg-gradient-to-r from-primary to-secondary text-white shadow-sm hover:brightness-110",
        )}
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : connected ? <Check className="h-3.5 w-3.5" /> : null}
        {connected ? "Manage" : actionLabel}
      </button>
    </motion.div>
  );
}

export function CoreChannelsSection({
  businessId,
  entries,
  onManageWhatsApp,
  onManageEntry,
}: {
  businessId: string;
  entries: DashboardEntryLike[];
  onManageWhatsApp: () => void;
  /** Open the page's manage/credential UI for any connected entry type. */
  onManageEntry: (type: string) => void;
}) {
  const [googleBusy, setGoogleBusy] = useState(false);
  const [metaBusy, setMetaBusy] = useState<string | null>(null);

  const statusOf = (type: string) => entries.find((e) => e.meta.type === type)?.health;
  const isConnected = (type: string) => statusOf(type)?.status === "connected";
  const connectedGoogle = GOOGLE_SERVICES.filter((s) => isConnected(s.type));

  const connectGoogle = async () => {
    setGoogleBusy(true);
    const res = await apiPost<{ authUrl?: string }>({
      path: `/connect/google-suite/businesses/${encodeURIComponent(businessId)}/auth-url`,
      body: {},
    });
    setGoogleBusy(false);
    if (res.data?.authUrl) {
      window.location.href = res.data.authUrl;
    } else {
      toast.error(res.error || "Could not start Google sign-in");
    }
  };

  // Meta OAuth is a POST that returns the facebook.com dialog URL as JSON.
  const startMetaOAuth = async (platform: "FACEBOOK" | "INSTAGRAM") => {
    setMetaBusy(platform);
    const res = await apiPost<{ authUrl?: string }>({
      path: `/social/businesses/${encodeURIComponent(businessId)}/connections/${platform}/oauth/start`,
      body: {},
    });
    setMetaBusy(null);
    if (res.data?.authUrl) {
      // assign() rather than `location.href =`. Identical navigation, but the
      // compiler reads the property write as mutating a value this component
      // does not own and rejects it; a method call says the same thing in a
      // form it can reason about.
      //
      // The Google branch twenty lines up writes location.href and is NOT
      // flagged, which is worth knowing rather than tidying: the rule is
      // reacting to something about this branch specifically, so making them
      // uniform would hide the asymmetry instead of explaining it.
      window.location.assign(res.data.authUrl);
    } else {
      toast.error(res.error || "Could not start Meta sign-in");
    }
  };

  const metaCard = (
    type: string,
    title: string,
    subtitle: string,
    Icon: typeof Facebook,
    platform: "FACEBOOK" | "INSTAGRAM",
  ) => (
    <ChannelCard
      key={type}
      icon={Icon}
      title={title}
      subtitle={subtitle}
      connected={isConnected(type) || isConnected("meta_social")}
      account={statusOf(type)?.connectedAccount ?? statusOf("meta_social")?.connectedAccount}
      actionLabel="Connect with Meta"
      busy={metaBusy === platform}
      onAction={() => (isConnected(type) || isConnected("meta_social") ? onManageEntry(type) : void startMetaOAuth(platform))}
    />
  );

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-semibold">Core Channels</h2>
        <span className="text-[10px] text-muted-foreground">
          Connect these first — everything else is optional
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <ChannelCard
          icon={Globe}
          title="Google Suite"
          subtitle="Gmail · Drive · Calendar · Forms · Contacts — one sign-in"
          connected={connectedGoogle.length > 0}
          account={connectedGoogle.length > 0 ? `${connectedGoogle.length}/6 services connected` : undefined}
          actionLabel="Sign in with Google"
          onAction={connectGoogle}
          busy={googleBusy}
        >
          <div className="flex flex-wrap gap-1">
            {GOOGLE_SERVICES.map((s) => (
              <span
                key={s.type}
                className={cn(
                  "rounded-full px-2 py-0.5 text-[9px] border",
                  isConnected(s.type)
                    ? "border-emerald-500/30 text-emerald-400"
                    : "border-border/40 text-muted-foreground",
                )}
              >
                {s.label}
              </span>
            ))}
          </div>
        </ChannelCard>

        {metaCard("facebook_page", "Facebook Page", "Messages, reviews & leads", Facebook, "FACEBOOK")}
        {metaCard("instagram", "Instagram", "DMs, comments & mentions", Instagram, "INSTAGRAM")}
        {metaCard("meta_messenger", "Messenger", "Facebook Messenger inbox", MessageCircle, "FACEBOOK")}

        <ChannelCard
          icon={Phone}
          title="WhatsApp Business"
          subtitle="Customer chats into Key Inbox"
          connected={isConnected("whatsapp")}
          account={statusOf("whatsapp")?.connectedAccount}
          actionLabel="Set up WhatsApp"
          onAction={onManageWhatsApp}
        />

        <ChannelCard
          icon={ExternalLink}
          title="Website & Storefront"
          subtitle="Always on — KEY reads your booking page"
          connected
          account="Live"
          actionLabel="Open storefront"
          onAction={() => (window.location.href = "/app/store")}
        />
      </div>
    </section>
  );
}
