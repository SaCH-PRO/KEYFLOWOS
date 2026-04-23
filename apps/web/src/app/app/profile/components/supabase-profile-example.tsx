"use client";

import { useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";

type ProfileRow = {
  id: string;
  display_name: string | null;
  created_at: string;
};

export default function SupabaseProfileExample() {
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const run = async () => {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setStatus("Supabase env not configured");
        setLoading(false);
        return;
      }

      const { data: userRes } = await supabase.auth.getUser();
      const user = userRes.user;
      if (!user) {
        setStatus("Sign in to use profile example");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("id,display_name,created_at")
        .eq("id", user.id)
        .maybeSingle();

      if (error) {
        setStatus(error.message);
      } else if (data) {
        setProfile(data as ProfileRow);
        setDisplayName((data as ProfileRow).display_name ?? "");
      }
      setLoading(false);
    };
    void run();
  }, []);

  const save = async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    setStatus(null);
    const { data: userRes } = await supabase.auth.getUser();
    const user = userRes.user;
    if (!user) {
      setStatus("No active session");
      return;
    }

    const { data, error } = await supabase
      .from("profiles")
      .upsert({ id: user.id, display_name: displayName.trim() || null }, { onConflict: "id" })
      .select("id,display_name,created_at")
      .single();

    if (error) {
      setStatus(error.message);
      return;
    }
    setProfile(data as ProfileRow);
    setStatus("Profile saved");
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-xs text-[hsl(30_10%_60%)]">
        Loading Supabase profile...
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="mb-2 text-sm font-medium text-[hsl(30_20%_95%)]">Supabase Profile Example</div>
      <div className="mb-3 text-xs text-[hsl(30_10%_60%)]">
        RLS-backed `public.profiles` read/write for the current signed-in user.
      </div>
      <input
        value={displayName}
        onChange={(e) => setDisplayName(e.target.value)}
        placeholder="Display name"
        className="mb-2 w-full rounded-md border border-white/10 bg-black/20 px-3 py-2 text-sm text-white"
      />
      <button
        type="button"
        onClick={save}
        className="rounded-md bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-400"
      >
        Save profile
      </button>
      {profile && (
        <div className="mt-3 text-xs text-[hsl(30_10%_65%)]">
          Current profile: <span className="text-white">{profile.display_name ?? "(empty)"}</span>
        </div>
      )}
      {status && <div className="mt-2 text-xs text-[hsl(30_10%_70%)]">{status}</div>}
    </div>
  );
}
