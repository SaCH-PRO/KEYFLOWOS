"use client";

import { useEffect, useState } from "react";
import { User, Mail, Phone, CheckCircle2, AlertCircle } from "lucide-react";
import { Button, Input, Card } from "@keyflow/ui";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default function ProfileSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState({
    email: "",
    name: "",
    phone: "",
  });

  useEffect(() => {
    const load = async () => {
      const token = localStorage.getItem("kf_token");
      if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
        setLoading(false);
        return;
      }

      try {
        const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`,
          },
        });
        if (res.ok) {
          const user = await res.json();
          setForm({
            email: user.email || "",
            name: user.user_metadata?.name || "",
            phone: user.phone || "",
          });
        }
      } catch (e) {
        console.error("Failed to load profile:", e);
      }
      setLoading(false);
    };
    load();
  }, []);

  const handleSave = async () => {
    const token = localStorage.getItem("kf_token");
    if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return;

    setSaving(true);
    setStatus(null);

    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          data: { name: form.name },
        }),
      });

      if (res.ok) {
        setStatus({ type: "success", message: "Profile updated" });
      } else {
        const err = await res.json();
        setStatus({ type: "error", message: err.message || "Failed to update" });
      }
    } catch (e) {
      setStatus({ type: "error", message: "Network error" });
    }
    setSaving(false);
  };

  if (loading) {
    return <div className="text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      {status && (
        <div
          className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${
            status.type === "success"
              ? "border border-emerald-400/40 bg-emerald-900/30 text-emerald-200"
              : "border border-red-400/40 bg-red-900/30 text-red-200"
          }`}
        >
          {status.type === "success" ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
          {status.message}
        </div>
      )}

      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <User className="h-4 w-4 text-primary" />
          Your Profile
        </div>

        <div className="space-y-4">
          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Mail className="h-3 w-3" />
              Email
            </div>
            <Input
              className="mt-1"
              type="email"
              value={form.email}
              disabled
              placeholder="you@example.com"
            />
            <p className="text-[11px] text-muted-foreground mt-1">Email cannot be changed here.</p>
          </label>

          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <User className="h-3 w-3" />
              Display Name
            </div>
            <Input
              className="mt-1"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Your name"
            />
          </label>

          <label className="block text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Phone className="h-3 w-3" />
              Phone Number
            </div>
            <Input
              className="mt-1"
              type="tel"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              placeholder="+1 868 123 4567"
            />
          </label>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
