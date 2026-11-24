"use client";

/**
 * NAV-A3 (sweep BUG-118): My account, the signed-in member's own account.
 *
 * It used to replace itself with /app/profile, the business's profile and Genome, so a team member asking for their
 * own account landed on the business's page. It reads GET /identity/me and saves the member's own name and phone with
 * PATCH /identity/me (PersonalInfoSection, the same form the business profile embeds). The business's page stays
 * /app/profile ("Business profile" in Settings).
 */
import { useEffect, useState } from "react";
import { UserRound, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { apiGet } from "@/lib/api";
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

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center bg-primary/10">
          <UserRound className="w-5 h-5 text-primary" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-foreground">My account</h1>
          {form ? (
            <p className="text-sm text-muted-foreground truncate">Signed in as {form.email}</p>
          ) : (
            <p className="text-sm text-muted-foreground">Your name, photo and phone</p>
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
    </div>
  );
}
