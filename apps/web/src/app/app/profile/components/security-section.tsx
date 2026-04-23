"use client";

import { useState } from "react";
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle, Moon, Sun, Monitor } from "lucide-react";
import { Button, Input } from "@keyflow/ui";
import { useTheme } from "next-themes";
import { AccordionSection, AccordionGroup } from "../../store/components/accordion-section";
import { apiPostSimple } from "@/lib/api";

function PasswordStrength({ password }: { password: string }) {
  const checks = [
    { label: "8+ characters", pass: password.length >= 8 },
    { label: "Uppercase letter", pass: /[A-Z]/.test(password) },
    { label: "Number", pass: /\d/.test(password) },
    { label: "Special character", pass: /[^A-Za-z0-9]/.test(password) },
  ];
  const score = checks.filter((c) => c.pass).length;
  const colors = [
    "hsl(var(--kf-error))",
    "hsl(var(--kf-warning))",
    "hsl(var(--kf-warning))",
    "hsl(var(--kf-success))",
  ];
  const labels = ["Weak", "Fair", "Good", "Strong"];

  if (!password) return null;

  return (
    <div className="space-y-2 mt-2">
      <div className="flex gap-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-1 flex-1 rounded-full transition-all duration-300"
            style={{
              backgroundColor: i < score ? colors[score - 1] : "hsl(var(--kf-muted) / 0.4)",
            }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {checks.map((c) => (
          <span
            key={c.label}
            className="text-[11px] flex items-center gap-1 transition-colors"
            style={{ color: c.pass ? "hsl(var(--kf-success))" : "hsl(var(--kf-muted-foreground))" }}
          >
            {c.pass ? <CheckCircle2 className="h-3 w-3" /> : <div className="h-3 w-3 rounded-full border border-current opacity-40" />}
            {c.label}
          </span>
        ))}
      </div>
      {score > 0 && (
        <p
          className="text-[11px] font-medium"
          style={{
            color: score >= 3 ? "hsl(var(--kf-success))" : score >= 2 ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))",
          }}
        >
          {labels[score - 1]} password
        </p>
      )}
    </div>
  );
}

interface SecuritySectionProps {
  onStatus: (status: { type: "success" | "error"; message: string } | null) => void;
}

export default function SecuritySection({ onStatus }: SecuritySectionProps) {
  const [passwordForm, setPasswordForm] = useState({ newPassword: "", confirmPassword: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const { theme, setTheme } = useTheme();

  const handleChangePassword = async () => {
    if (!passwordForm.newPassword) { onStatus({ type: "error", message: "Please enter a new password" }); return; }
    if (passwordForm.newPassword !== passwordForm.confirmPassword) { onStatus({ type: "error", message: "Passwords do not match" }); return; }
    if (passwordForm.newPassword.length < 8) { onStatus({ type: "error", message: "Password must be at least 8 characters" }); return; }

    setSavingPassword(true);
    onStatus(null);
    try {
      const res = await apiPostSimple<{ success: boolean }>("/identity/me/password", {
        newPassword: passwordForm.newPassword,
      });
      if (res.data?.success) {
        onStatus({ type: "success", message: "Password updated successfully" });
        setPasswordForm({ newPassword: "", confirmPassword: "" });
      } else {
        onStatus({ type: "error", message: res.error || "Failed to update password" });
      }
    } catch {
      onStatus({ type: "error", message: "Network error" });
    }
    setSavingPassword(false);
  };

  return (
    <AccordionGroup title="Security & Preferences">
      <AccordionSection
        title="Change Password"
        subtitle="Update your account password"
        icon={Lock}
        accentColor="hsl(var(--kf-accent1))"
      >
        <form
          onSubmit={(e) => { e.preventDefault(); handleChangePassword(); }}
          className="space-y-4 p-1"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="block text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 mb-1.5 font-medium">New Password</div>
              <div className="relative">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={passwordForm.newPassword}
                  onChange={(e) => setPasswordForm((f) => ({ ...f, newPassword: e.target.value }))}
                  placeholder="Enter new password"
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  onClick={() => setShowPassword((p) => !p)}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </label>
            <label className="block text-xs text-muted-foreground">
              <div className="flex items-center gap-1.5 mb-1.5 font-medium">Confirm Password</div>
              <Input
                type="password"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                placeholder="Confirm new password"
              />
              {passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword && (
                <p className="text-[11px] mt-1 flex items-center gap-1" style={{ color: "hsl(var(--kf-error))" }}>
                  <AlertCircle className="h-3 w-3" />
                  Passwords do not match
                </p>
              )}
            </label>
          </div>
          <PasswordStrength password={passwordForm.newPassword} />
          <div className="flex justify-end pt-2 border-t border-border/30">
            <Button
              type="submit"
              disabled={savingPassword || !passwordForm.newPassword || passwordForm.newPassword !== passwordForm.confirmPassword}
              className="min-h-[44px]"
            >
              {savingPassword ? "Updating..." : "Update Password"}
            </Button>
          </div>
        </form>
      </AccordionSection>

      <AccordionSection
        title="Appearance"
        subtitle="Choose your preferred theme"
        icon={theme === "dark" ? Moon : Sun}
        accentColor="hsl(var(--kf-accent2))"
      >
        <div className="grid grid-cols-3 gap-3 p-1">
          {[
            { value: "light", icon: Sun, label: "Light" },
            { value: "dark", icon: Moon, label: "Dark" },
            { value: "system", icon: Monitor, label: "System" },
          ].map(({ value, icon: Icon, label }) => (
            <button
              key={value}
              onClick={() => setTheme(value)}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all min-h-[44px]"
              style={{
                borderColor: theme === value ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-border) / 0.4)",
                background: theme === value ? "hsl(var(--kf-accent1) / 0.1)" : "hsl(var(--kf-muted) / 0.1)",
              }}
            >
              <Icon
                className="h-5 w-5"
                style={{ color: theme === value ? "hsl(var(--kf-accent1))" : "hsl(var(--kf-muted-foreground))" }}
              />
              <span
                className="text-sm font-medium"
                style={{ color: theme === value ? "hsl(var(--kf-foreground))" : "hsl(var(--kf-muted-foreground))" }}
              >
                {label}
              </span>
            </button>
          ))}
        </div>
      </AccordionSection>
    </AccordionGroup>
  );
}
