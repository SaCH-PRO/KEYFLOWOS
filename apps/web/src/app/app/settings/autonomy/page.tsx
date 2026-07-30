"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Bot, Shield, AlertTriangle, Save, Power } from "lucide-react";
import { Button, Input } from "@keyflow/ui";
import { getStoredBusinessId } from "@/lib/workspace";
import { fetchAutonomyProfile, updateAutonomyProfile, type AutonomyProfile } from "@/lib/client";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

export default function AutonomySettingsPage() {
  const [profile, setProfile] = useState<AutonomyProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKillConfirm, setShowKillConfirm] = useState(false);

  const load = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    const res = await fetchAutonomyProfile(businessId);
    if (res.data) setProfile(res.data);
    else if (res.error) toast.error(res.error);
    setLoading(false);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- async autonomy profile hydration
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    const businessId = getStoredBusinessId();
    if (!businessId || !profile) return;
    setSaving(true);
    const res = await updateAutonomyProfile(businessId, {
      globalKillSwitch: profile.globalKillSwitch,
      maxDailyAutoActions: profile.maxDailyAutoActions,
      maxDailySpendTtd: profile.maxDailySpendTtd,
      maxTierWithoutApproval: profile.maxTierWithoutApproval,
      notifyOnBlock: profile.notifyOnBlock,
    });
    setSaving(false);
    if (res.error) toast.error(res.error);
    else {
      toast.success("Autonomy profile saved");
      if (res.data) setProfile(res.data);
    }
  };

  const toggleKillSwitch = () => {
    if (!profile?.globalKillSwitch) {
      setShowKillConfirm(true);
    } else {
      setProfile((p) => (p ? { ...p, globalKillSwitch: false } : p));
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl space-y-6 animate-pulse">
        <div className="h-10 w-1/3 bg-muted/20 rounded-lg" />
        <div className="h-40 bg-muted/10 rounded-xl border border-border/30" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-3xl">
        <p className="text-sm text-muted-foreground">Unable to load autonomy settings.</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
          >
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground/90">KEY Autonomy</h1>
            <p className="text-xs text-muted-foreground/60">Control autonomous execution limits and kill switches</p>
          </div>
        </div>
        <Button onClick={save} disabled={saving} size="sm">
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {saving ? "Saving..." : "Save changes"}
        </Button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-xl border border-border/30 bg-card/30 p-5 space-y-5"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${profile.globalKillSwitch ? "bg-red-500/10" : "bg-emerald-500/10"}`}>
              <Power className={`w-5 h-5 ${profile.globalKillSwitch ? "text-red-400" : "text-emerald-400"}`} />
            </div>
            <div>
              <h2 className="text-sm font-medium text-foreground/90">Global Kill Switch</h2>
              <p className="text-xs text-muted-foreground/60">Immediately blocks all autonomous KEY actions</p>
            </div>
          </div>
          <Button
            variant={profile.globalKillSwitch ? "destructive" : "default"}
            size="sm"
            onClick={toggleKillSwitch}
          >
            {profile.globalKillSwitch ? "KILLED — Restore" : "Enable Kill Switch"}
          </Button>
        </div>

        {profile.globalKillSwitch && (
          <div className="rounded-lg bg-red-500/10 border border-red-500/20 p-3 flex items-start gap-2 text-xs text-red-300">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            Autonomous execution is currently disabled. KEY will still answer questions but will not take actions on your behalf.
          </div>
        )}
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="rounded-xl border border-border/30 bg-card/30 p-5 space-y-5"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[hsl(var(--kf-accent1))]/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-[hsl(var(--kf-accent1))]" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-foreground/90">Safety Limits</h2>
            <p className="text-xs text-muted-foreground/60">Cap what KEY can do without human approval</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Max daily auto actions</label>
            <Input
              type="number"
              min={0}
              value={profile.maxDailyAutoActions}
              onChange={(e) => setProfile((p) => (p ? { ...p, maxDailyAutoActions: parseInt(e.target.value, 10) || 0 } : p))}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Max daily spend (TTD, 0 = unlimited)</label>
            <Input
              type="number"
              min={0}
              step="0.01"
              value={profile.maxDailySpendTtd}
              onChange={(e) => setProfile((p) => (p ? { ...p, maxDailySpendTtd: parseFloat(e.target.value) || 0 } : p))}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Max tier without approval (1-4)</label>
            <Input
              type="number"
              min={1}
              max={4}
              value={profile.maxTierWithoutApproval}
              onChange={(e) => setProfile((p) => (p ? { ...p, maxTierWithoutApproval: Math.min(4, Math.max(1, parseInt(e.target.value, 10) || 1)) } : p))}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Notify on block</label>
            <div className="flex items-center gap-2 h-10">
              <Button
                variant={profile.notifyOnBlock ? "default" : "subtle"}
                size="sm"
                onClick={() => setProfile((p) => (p ? { ...p, notifyOnBlock: true } : p))}
              >
                On
              </Button>
              <Button
                variant={!profile.notifyOnBlock ? "default" : "subtle"}
                size="sm"
                onClick={() => setProfile((p) => (p ? { ...p, notifyOnBlock: false } : p))}
              >
                Off
              </Button>
            </div>
          </div>
        </div>
      </motion.div>

      <ConfirmDialog
        open={showKillConfirm}
        title="Activate Kill Switch?"
        message="This will immediately stop KEY from executing any autonomous actions. You can turn it back off at any time."
        confirmLabel="Activate"
        variant="danger"
        onConfirm={() => {
          setProfile((p) => (p ? { ...p, globalKillSwitch: true } : p));
          setShowKillConfirm(false);
        }}
        onCancel={() => setShowKillConfirm(false)}
      />
    </div>
  );
}
