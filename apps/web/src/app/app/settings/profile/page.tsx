"use client";

/**
 * NAV-A3 (sweep BUG-118): My account, the signed-in member's own account.
 *
 * It used to replace itself with /app/profile, the business's profile and Genome, so a team member asking for their
 * own account landed on the business's page. It reads GET /identity/me and saves the member's own name and phone with
 * PATCH /identity/me (PersonalInfoSection, the same form the business profile embeds). The business's page stays
 * /app/profile ("Business profile" in Settings).
 *
 * FU-PUSH-OPTIN-MY-ACCOUNT (D-282): it also holds the member's own push notifications on this device (DevicePushSection),
 * for every member, settings access or not. They were the Push tab of Settings > Notifications, which only settings
 * readers can open since D-276; that page keeps the business's customer emails and links here.
 */
import { useEffect, useState } from "react";
import { UserRound, AlertCircle, CheckCircle2, Loader2, BellRing, BellOff } from "lucide-react";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { usePushNotifications, type PushStatus } from "@/hooks/use-push-notifications";
import PersonalInfoSection from "@/app/app/profile/components/personal-info-section";

interface IdentityMe {
  id: string;
  email: string;
  name?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
}

type Form = { email: string; name: string; firstName: string; lastName: string; phone: string };
type Status = { type: "success" | "error"; message: string } | null;

export default function MyAccountPage() {
  const [form, setForm] = useState<Form | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    let live = true;
    void apiGet<IdentityMe>("/identity/me").then(({ data, error }) => {
      if (!live) return;
      if (error || !data) {
        setLoadError(error || "Your account could not be read.");
        return;
      }
      setForm({
        email: data.email || "",
        name: data.name || "",
        firstName: data.firstName || "",
        lastName: data.lastName || "",
        phone: data.phone || "",
      });
      setAvatarUrl(data.avatarUrl || null);
    });
    return () => { live = false; };
  }, []);

  // pb-24 below md: the push section is the page's last, and on a phone the fixed bottom nav would cover its button.
  // The app scroll root's pb-28 does not clear it: the page overflows the h-full PageTransition box, past that padding.
  return (
    <div className="max-w-2xl mx-auto space-y-5 pb-24 md:pb-0">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-primary/10">
          <UserRound className="w-5 h-5 text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground">My account</h1>
          {form ? (
            <p className="text-sm text-muted-foreground truncate">Signed in as {form.email}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Your name, photo, phone and push notifications</p>
          )}
        </div>
      </div>

      {loadError ? (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-2 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>Your account could not be loaded ({loadError}). Refresh the page to try again.</span>
        </div>
      ) : !form ? (
        <div className="rounded-xl border border-border/60 bg-card/60 p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground" aria-busy="true">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Loading your account...
        </div>
      ) : (
        <div className="kf-card p-6 space-y-4">
          {status && (
            <div
              role={status.type === "error" ? "alert" : "status"}
              className={`rounded-lg px-3 py-2 text-sm flex items-center gap-2 ${status.type === "error" ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"}`}
            >
              {status.type === "error" ? <AlertCircle className="w-4 h-4" aria-hidden="true" /> : <CheckCircle2 className="w-4 h-4" aria-hidden="true" />}
              {status.message}
            </div>
          )}
          <PersonalInfoSection
            initialData={form}
            avatarUrl={avatarUrl}
            onSaved={(saved, avatar) => { setForm(saved); setAvatarUrl(avatar); }}
            onStatus={setStatus}
          />
        </div>
      )}

      <DevicePushSection />
    </div>
  );
}

/**
 * FU-PUSH-OPTIN-MY-ACCOUNT (D-282): the member's own push notifications on this device, for every member. It used to
 * be the Push tab of Settings > Notifications, which only settings readers can open since D-276. The business's
 * customer emails stay there; nothing of them is read here.
 */
function DevicePushSection() {
  const businessId = getStoredBusinessId();
  const { status, busy, error, subscribe, unsubscribe, retry } = usePushNotifications(businessId);

  const line: Record<PushStatus, string | null> = {
    loading: "Checking this device...",
    unsupported:
      "This browser can't receive push notifications. On iPhone or iPad, add KEYFLOWOS to your Home Screen and open it from there; elsewhere, use a current Chrome, Edge, Firefox or Safari.",
    denied: "Notifications are blocked for KEYFLOWOS in this browser. Allow them in your browser's site settings, then reload this page.",
    unconfigured: "Push notifications are not set up on this server yet, so they can't be turned on.",
    unavailable: null,
    subscribed: "On for this device.",
    unsubscribed: "Off for this device.",
  };
  const text = line[status];

  return (
    <section aria-labelledby="device-push-heading" className="kf-card p-6 space-y-3">
      <div className="flex items-start gap-3">
        <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${status === "subscribed" ? "bg-emerald-500/10" : "bg-muted/40"}`}>
          {status === "subscribed" ? (
            <BellRing className="w-4 h-4 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          ) : (
            <BellOff className="w-4 h-4 text-muted-foreground" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="device-push-heading" className="text-base font-semibold text-foreground">Push notifications on this device</h2>
          <p className="text-sm text-muted-foreground">
            Alerts on this device, even when KEYFLOWOS is closed. This is your own setting and applies to this browser only.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        {text && (
          <p className="text-sm text-foreground min-w-0 flex-1" aria-live="polite" aria-busy={status === "loading" || busy}>
            {status === "loading" && <Loader2 className="inline w-4 h-4 mr-1.5 animate-spin align-[-3px]" aria-hidden="true" />}
            {text}
          </p>
        )}
        {status === "unsubscribed" && (
          <button
            type="button"
            onClick={() => void subscribe()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors shrink-0"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            Turn on
          </button>
        )}
        {status === "subscribed" && (
          <button
            type="button"
            onClick={() => void unsubscribe()}
            disabled={busy}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium border border-border/60 bg-card hover:bg-muted/40 disabled:opacity-60 transition-colors shrink-0"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
            Turn off
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">{error}</span>
          {status === "unavailable" && (
            <button type="button" onClick={retry} className="shrink-0 font-medium underline underline-offset-2">
              Retry
            </button>
          )}
        </div>
      )}
    </section>
  );
}
