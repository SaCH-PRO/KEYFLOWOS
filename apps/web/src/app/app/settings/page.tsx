"use client";

import { useEffect, useState } from "react";
import { Shield, CheckCircle2 } from "lucide-react";
import { Card, Button, Input } from "@keyflow/ui";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default function SettingsPage() {
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    const token = typeof window !== "undefined" ? window.localStorage.getItem("kf_token") : null;
    if (token) setAuthToken(token);
  }, []);

  const updatePassword = async () => {
    setPasswordStatus(null);
    if (!newPassword || newPassword !== confirmPassword) {
      setPasswordStatus("Passwords do not match.");
      return;
    }
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !authToken) {
      setPasswordStatus("Unable to update password.");
      return;
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ password: newPassword }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setPasswordStatus(json.message || json.error_description || "Password update failed");
        return;
      }
      setPasswordStatus("Password updated.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch {
      setPasswordStatus("Password update failed");
    }
  };

  const sendResetLink = async () => {
    setPasswordStatus(null);
    if (!resetEmail.trim() || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setPasswordStatus("Enter your email to send reset link.");
      return;
    }
    try {
      const res = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ email: resetEmail.trim() }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setPasswordStatus(json.message || "Failed to send reset link");
        return;
      }
      setPasswordStatus("Reset link sent. Check your email.");
    } catch {
      setPasswordStatus("Failed to send reset link");
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Shield className="h-4 w-4 text-primary" />
          Security
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <div className="space-y-3">
            <h3 className="text-sm font-medium">Change Password</h3>
            <label className="block text-xs text-muted-foreground">
              Current Password
              <div className="relative mt-1">
                <Input
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="pr-12"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-2 text-primary text-[11px]"
                  onClick={() => setShowCurrent((p) => !p)}
                >
                  {showCurrent ? "Hide" : "Show"}
                </button>
              </div>
            </label>
            <label className="block text-xs text-muted-foreground">
              New Password
              <div className="relative mt-1">
                <Input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="pr-12"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-2 text-primary text-[11px]"
                  onClick={() => setShowNew((p) => !p)}
                >
                  {showNew ? "Hide" : "Show"}
                </button>
              </div>
            </label>
            <label className="block text-xs text-muted-foreground">
              Confirm New Password
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1"
              />
            </label>
            <div className="flex justify-end">
              <Button onClick={updatePassword}>Update Password</Button>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-medium">Forgot Password?</h3>
            <p className="text-xs text-muted-foreground">
              Send a reset link to your email address.
            </p>
            <label className="block text-xs text-muted-foreground">
              Email Address
              <Input
                type="email"
                value={resetEmail}
                onChange={(e) => setResetEmail(e.target.value)}
                placeholder="you@example.com"
                className="mt-1"
              />
            </label>
            <div className="flex justify-end">
              <Button variant="outline" onClick={sendResetLink}>Send Reset Link</Button>
            </div>
          </div>
        </div>

        {passwordStatus && (
          <div className="flex items-center gap-2 rounded-xl border border-emerald-400/40 bg-emerald-900/30 px-3 py-2 text-xs text-emerald-200">
            <CheckCircle2 className="h-4 w-4" />
            {passwordStatus}
          </div>
        )}
      </Card>
    </div>
  );
}
