"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Brain,
  Users,
  Zap,
  Shield,
  Trash2,
  Plus,
  X,
  Check,
  Edit3,
  Tag,
  DollarSign,
  Activity,
  Crown,
} from "lucide-react";
import { Button, Input } from "@keyflow/ui";
import { Dialog } from "@keyflow/ui";
import { getStoredBusinessId } from "@/lib/workspace";
import {
  fetchAiSettings,
  updateAiSettings,
  updateStaffAiSettings,
  fetchSkills,
  createSkill,
  deleteSkill,
  assignSkillToMembership,
  removeSkillFromMembership,
  assignSkillToStaff,
  removeSkillFromStaff,
  fetchAuthorityGrants,
  createAuthorityGrant,
  revokeAuthorityGrant,
  fetchTeamCapacity,
  type Skill,
  type AuthorityGrant,
  type TeamCapacityMember,
} from "@/lib/client";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type TabKey = "capacity" | "skills" | "authority";
const TABS: { key: TabKey; label: string; icon: typeof Activity }[] = [
  { key: "capacity", label: "Capacity", icon: Activity },
  { key: "skills", label: "Skills", icon: Zap },
  { key: "authority", label: "Authority Grants", icon: Shield },
];

function Skeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-9 w-full bg-muted/20 rounded-lg" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 p-4 rounded-xl border border-border/30">
          <div className="w-10 h-10 rounded-full bg-muted/30" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-32 bg-muted/30 rounded" />
            <div className="h-3 w-48 bg-muted/20 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

function getUtilizationColor(pct: number) {
  if (pct > 100) return "text-red-400";
  if (pct > 80) return "text-amber-400";
  return "text-emerald-400";
}

function getUtilizationBg(pct: number) {
  if (pct > 100) return "bg-red-500";
  if (pct > 80) return "bg-amber-500";
  return "bg-emerald-500";
}

export default function AiSettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>("capacity");
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<TeamCapacityMember[]>([]);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [grants, setGrants] = useState<AuthorityGrant[]>([]);
  const [capacityHours, setCapacityHours] = useState(0);

  const load = useCallback(async () => {
    const businessId = getStoredBusinessId();
    if (!businessId) { setLoading(false); return; }
    setLoading(true);
    try {
      const [settingsRes, skillsRes, grantsRes, capacityRes] = await Promise.all([
        fetchAiSettings(businessId),
        fetchSkills(businessId),
        fetchAuthorityGrants(businessId),
        fetchTeamCapacity(businessId),
      ]);
      if (settingsRes.data) {
        setCapacityHours(settingsRes.data.capacityHours);
        if (skillsRes.data) setSkills(skillsRes.data);
        else if (settingsRes.data.skills) setSkills(settingsRes.data.skills);
        if (grantsRes.data) setGrants(grantsRes.data);
        else if (settingsRes.data.authorityGrants) setGrants(settingsRes.data.authorityGrants);
      }
      if (capacityRes.data) setMembers(capacityRes.data);
      else if (settingsRes.error) toast.error(settingsRes.error);
      if (skillsRes.error) toast.error(skillsRes.error);
      if (grantsRes.error) toast.error(grantsRes.error);
      if (capacityRes.error) toast.error(capacityRes.error);
    } catch {
      toast.error("Failed to load AI settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))" }}
          >
            <Brain className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground/90">L4 AI Settings</h1>
            <p className="text-xs text-muted-foreground/60">Manager-tier capacity, skills, and authority grants</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="px-2 py-1 rounded bg-muted/20 border border-border/30">{members.length} team members</span>
          <span className="px-2 py-1 rounded bg-muted/20 border border-border/30">{capacityHours}h capacity</span>
        </div>
      </div>

      <div className="flex items-center border-b border-border/30">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all border-b-2 ${
              activeTab === t.key
                ? "border-[hsl(var(--kf-accent1))] text-foreground/90"
                : "border-transparent text-muted-foreground/50 hover:text-foreground/70"
            }`}
          >
            <t.icon className="w-4 h-4" />
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <Skeleton />
      ) : (
        <AnimatePresence mode="wait">
          {activeTab === "capacity" && (
            <motion.div
              key="capacity"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <CapacityTab members={members} skills={skills} onChange={load} />
            </motion.div>
          )}
          {activeTab === "skills" && (
            <motion.div
              key="skills"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <SkillsTab skills={skills} members={members} onChange={load} />
            </motion.div>
          )}
          {activeTab === "authority" && (
            <motion.div
              key="authority"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
            >
              <AuthorityTab grants={grants} onChange={load} />
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

function CapacityTab({
  members,
  skills,
  onChange,
}: {
  members: TeamCapacityMember[];
  skills: Skill[];
  onChange: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValues, setEditValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const startEdit = (m: TeamCapacityMember) => {
    setEditingId(m.id);
    setEditValues({
      dailyCapacityHours: m.dailyCapacityHours?.toString() ?? "8",
      maxHoursPerWeek: m.maxHoursPerWeek?.toString() ?? "40",
      hourlyRate: m.hourlyRate?.toString() ?? "",
    });
  };

  const saveEdit = async (m: TeamCapacityMember) => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    setSaving(true);
    try {
      if (m.type === "membership") {
        const dailyCapacityHours = parseFloat(editValues.dailyCapacityHours);
        if (Number.isNaN(dailyCapacityHours)) {
          toast.error("Invalid daily capacity");
          return;
        }
        const res = await updateAiSettings(businessId, m.id, { dailyCapacityHours });
        if (res.error) toast.error(res.error);
        else toast.success("Capacity updated");
      } else {
        const maxHoursPerWeek = editValues.maxHoursPerWeek ? parseFloat(editValues.maxHoursPerWeek) : undefined;
        const hourlyRate = editValues.hourlyRate ? parseFloat(editValues.hourlyRate) : undefined;
        const res = await updateStaffAiSettings(businessId, m.id, { maxHoursPerWeek, hourlyRate });
        if (res.error) toast.error(res.error);
        else toast.success("Staff settings updated");
      }
      onChange();
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
      setEditingId(null);
    }
  };

  return (
    <div className="rounded-xl border border-border/30 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full w-full text-xs">
          <thead>
            <tr className="border-b border-border/20 bg-muted/10">
              <th className="text-left px-3 py-2.5 text-muted-foreground/60 font-medium">Name</th>
              <th className="text-left px-3 py-2.5 text-muted-foreground/60 font-medium">Type</th>
              <th className="text-left px-3 py-2.5 text-muted-foreground/60 font-medium">Daily Capacity</th>
              <th className="text-left px-3 py-2.5 text-muted-foreground/60 font-medium">Max Hrs/Week</th>
              <th className="text-left px-3 py-2.5 text-muted-foreground/60 font-medium">Hourly Rate</th>
              <th className="text-left px-3 py-2.5 text-muted-foreground/60 font-medium">Skills</th>
              <th className="text-left px-3 py-2.5 text-muted-foreground/60 font-medium">Utilization</th>
              <th className="text-right px-3 py-2.5 text-muted-foreground/60 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const isEditing = editingId === m.id;
              return (
                <tr key={m.id} className="border-b border-border/10 last:border-0 hover:bg-muted/5">
                  <td className="px-3 py-2.5 font-medium text-foreground/80">{m.name}</td>
                  <td className="px-3 py-2.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${
                      m.type === "membership" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                    }`}>
                      {m.type}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    {isEditing && m.type === "membership" ? (
                      <Input
                        type="number"
                        className="w-20 h-7 text-xs"
                        value={editValues.dailyCapacityHours}
                        onChange={(e) => setEditValues((p) => ({ ...p, dailyCapacityHours: e.target.value }))}
                      />
                    ) : (
                      <span className="text-muted-foreground">{m.dailyCapacityHours ?? "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {isEditing && m.type === "staff" ? (
                      <Input
                        type="number"
                        className="w-20 h-7 text-xs"
                        value={editValues.maxHoursPerWeek}
                        onChange={(e) => setEditValues((p) => ({ ...p, maxHoursPerWeek: e.target.value }))}
                      />
                    ) : (
                      <span className="text-muted-foreground">{m.maxHoursPerWeek ?? "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {isEditing && m.type === "staff" ? (
                      <Input
                        type="number"
                        className="w-20 h-7 text-xs"
                        value={editValues.hourlyRate}
                        onChange={(e) => setEditValues((p) => ({ ...p, hourlyRate: e.target.value }))}
                      />
                    ) : (
                      <span className="text-muted-foreground">{m.hourlyRate ? `$${m.hourlyRate}` : "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {m.skills.map((s) => (
                        <span key={s.id} className="text-[10px] px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground border border-border/20">
                          {s.name}
                        </span>
                      ))}
                      {m.skills.length === 0 && <span className="text-muted-foreground/40">—</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${getUtilizationBg(m.utilizationPercent)}`}
                          style={{ width: `${Math.min(m.utilizationPercent, 100)}%` }}
                        />
                      </div>
                      <span className={`text-[10px] font-medium ${getUtilizationColor(m.utilizationPercent)}`}>
                        {m.utilizationPercent}%
                      </span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {isEditing ? (
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="subtle" size="sm" className="h-7 w-7 p-0" onClick={() => setEditingId(null)} disabled={saving}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="subtle" size="sm" className="h-7 w-7 p-0" onClick={() => saveEdit(m)} disabled={saving}>
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                        </Button>
                      </div>
                    ) : (
                      <Button variant="subtle" size="sm" className="h-7 w-7 p-0" onClick={() => startEdit(m)}>
                        <Edit3 className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SkillsTab({
  skills,
  members,
  onChange,
}: {
  skills: Skill[];
  members: TeamCapacityMember[];
  onChange: () => void;
}) {
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillCategory, setNewSkillCategory] = useState("general");
  const [newSkillDesc, setNewSkillDesc] = useState("");
  const [adding, setAdding] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Skill | null>(null);
  const [processing, setProcessing] = useState(false);

  const handleAdd = async () => {
    const businessId = getStoredBusinessId();
    if (!businessId || !newSkillName.trim()) return;
    setAdding(true);
    const res = await createSkill(businessId, {
      name: newSkillName.trim(),
      category: newSkillCategory,
      description: newSkillDesc || undefined,
    });
    setAdding(false);
    if (res.error) toast.error(res.error);
    else {
      toast.success("Skill created");
      setNewSkillName("");
      setNewSkillCategory("general");
      setNewSkillDesc("");
      onChange();
    }
  };

  const handleDelete = async (skill: Skill) => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    setProcessing(true);
    const res = await deleteSkill(businessId, skill.id);
    setProcessing(false);
    setConfirmDelete(null);
    if (res.error) toast.error(res.error);
    else {
      toast.success("Skill deleted");
      onChange();
    }
  };

  return (
    <div className="space-y-5">
      <div className="kf-card p-4 space-y-3 border border-[hsl(var(--kf-accent1))]/20">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Plus className="h-4 w-4 text-[hsl(var(--kf-accent1))]" />
          Add Skill
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            className="flex-1"
            placeholder="Skill name"
            value={newSkillName}
            onChange={(e) => setNewSkillName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          />
          <select
            className="rounded-lg border border-border/60 bg-[#111113] px-3 py-2 text-sm min-w-[120px]"
            value={newSkillCategory}
            onChange={(e) => setNewSkillCategory(e.target.value)}
          >
            {["general", "design", "writing", "video", "sales", "support", "operations", "finance", "marketing"].map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <Button onClick={handleAdd} disabled={adding || !newSkillName.trim()} size="sm">
            {adding ? "Adding..." : "Add"}
          </Button>
        </div>
        <Input
          placeholder="Description (optional)"
          value={newSkillDesc}
          onChange={(e) => setNewSkillDesc(e.target.value)}
          className="text-sm"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {skills.map((skill) => (
          <div
            key={skill.id}
            className="rounded-xl border border-border/30 bg-card/30 p-4 hover:bg-card/50 transition-colors group"
          >
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Tag className="h-3.5 w-3.5 text-[hsl(var(--kf-accent1))]" />
                  <span className="text-sm font-medium truncate">{skill.name}</span>
                </div>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/20 text-muted-foreground border border-border/20 mt-1 inline-block">
                  {skill.category}
                </span>
                {skill.description && (
                  <p className="text-xs text-muted-foreground/60 mt-2 line-clamp-2">{skill.description}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                <Button
                  variant="subtle"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => { setSelectedSkill(skill); setShowAssign(true); }}
                  aria-label="Assign skill"
                >
                  <Users className="w-3.5 h-3.5 text-muted-foreground" />
                </Button>
                <Button
                  variant="subtle"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => setConfirmDelete(skill)}
                  aria-label="Delete skill"
                >
                  <Trash2 className="w-3.5 h-3.5 text-red-400" />
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {skills.length === 0 && (
        <div className="kf-card p-8 text-center">
          <Zap className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
          <h3 className="text-sm font-medium mb-1">No Skills Yet</h3>
          <p className="text-xs text-muted-foreground">Add skills to track team capabilities.</p>
        </div>
      )}

      <Dialog open={showAssign} onClose={() => setShowAssign(false)} title={`Assign ${selectedSkill?.name}`}>
        <div className="space-y-3 max-h-[60vh] overflow-y-auto">
          {members.map((m) => {
            const hasSkill = m.skills.some((s) => s.id === selectedSkill?.id);
            return (
              <div key={m.id} className="flex items-center justify-between p-2 rounded-lg hover:bg-muted/10">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{m.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    m.type === "membership" ? "bg-blue-500/10 text-blue-400 border-blue-500/20" : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  }`}>
                    {m.type}
                  </span>
                </div>
                <Button
                  variant={hasSkill ? "subtle" : "default"}
                  size="sm"
                  onClick={async () => {
                    const businessId = getStoredBusinessId();
                    if (!businessId || !selectedSkill) return;
                    setProcessing(true);
                    if (hasSkill) {
                      if (m.type === "membership") {
                        await removeSkillFromMembership(businessId, m.id, selectedSkill.id);
                      } else {
                        await removeSkillFromStaff(businessId, m.id, selectedSkill.id);
                      }
                      toast.success("Skill removed");
                    } else {
                      if (m.type === "membership") {
                        await assignSkillToMembership(businessId, m.id, selectedSkill.id);
                      } else {
                        await assignSkillToStaff(businessId, m.id, selectedSkill.id);
                      }
                      toast.success("Skill assigned");
                    }
                    setProcessing(false);
                    onChange();
                  }}
                  disabled={processing}
                >
                  {hasSkill ? "Remove" : "Assign"}
                </Button>
              </div>
            );
          })}
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!confirmDelete}
        title="Delete Skill"
        message={`Are you sure you want to delete "${confirmDelete?.name}"? This will remove it from all team members.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => confirmDelete && handleDelete(confirmDelete)}
        onCancel={() => setConfirmDelete(null)}
      />
    </div>
  );
}

function AuthorityTab({
  grants,
  onChange,
}: {
  grants: AuthorityGrant[];
  onChange: () => void;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [newGrant, setNewGrant] = useState<Partial<AuthorityGrant>>({
    granteeType: "USER",
    scope: "tier4_operations",
  });
  const [adding, setAdding] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<AuthorityGrant | null>(null);

  const handleAdd = async () => {
    const businessId = getStoredBusinessId();
    if (!businessId || !newGrant.granteeId || !newGrant.scope) return;
    setAdding(true);
    const res = await createAuthorityGrant(businessId, {
      granteeType: newGrant.granteeType as "KEY" | "USER",
      granteeId: newGrant.granteeId,
      scope: newGrant.scope as "tier4_financial" | "tier4_publishing" | "tier4_operations",
      maxAmount: newGrant.maxAmount ?? undefined,
      validFrom: newGrant.validFrom ?? undefined,
      validUntil: newGrant.validUntil ?? undefined,
    });
    setAdding(false);
    if (res.error) toast.error(res.error);
    else {
      toast.success("Authority grant created");
      setShowAdd(false);
      setNewGrant({ granteeType: "USER", scope: "tier4_operations" });
      onChange();
    }
  };

  const handleRevoke = async (grant: AuthorityGrant) => {
    const businessId = getStoredBusinessId();
    if (!businessId) return;
    const res = await revokeAuthorityGrant(businessId, grant.id);
    setConfirmRevoke(null);
    if (res.error) toast.error(res.error);
    else {
      toast.success("Grant revoked");
      onChange();
    }
  };

  const activeGrants = grants.filter((g) => !g.revokedAt);
  const revokedGrants = grants.filter((g) => g.revokedAt);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Shield className="h-4 w-4 text-[hsl(var(--kf-accent1))]" />
          <span>{activeGrants.length} active grant{activeGrants.length !== 1 ? "s" : ""}</span>
        </div>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          New Grant
        </Button>
      </div>

      <div className="rounded-xl border border-border/30 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full w-full text-xs">
            <thead>
              <tr className="border-b border-border/20 bg-muted/10">
                <th className="text-left px-3 py-2.5 text-muted-foreground/60 font-medium">Scope</th>
                <th className="text-left px-3 py-2.5 text-muted-foreground/60 font-medium">Grantee</th>
                <th className="text-left px-3 py-2.5 text-muted-foreground/60 font-medium">Max Amount</th>
                <th className="text-left px-3 py-2.5 text-muted-foreground/60 font-medium">Valid From</th>
                <th className="text-left px-3 py-2.5 text-muted-foreground/60 font-medium">Valid Until</th>
                <th className="text-left px-3 py-2.5 text-muted-foreground/60 font-medium">Status</th>
                <th className="text-right px-3 py-2.5 text-muted-foreground/60 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {[...activeGrants, ...revokedGrants].map((g) => {
                const isRevoked = !!g.revokedAt;
                const isExpired = g.validUntil ? new Date(g.validUntil) < new Date() : false;
                return (
                  <tr key={g.id} className={`border-b border-border/10 last:border-0 ${isRevoked ? "opacity-50" : ""}`}>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {g.scope === "tier4_financial" ? <DollarSign className="w-3 h-3 text-emerald-400" /> :
                         g.scope === "tier4_publishing" ? <Crown className="w-3 h-3 text-amber-400" /> :
                         <Shield className="w-3 h-3 text-blue-400" />}
                        <span className="text-foreground/80">{g.scope.replace("tier4_", "")}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                          g.granteeType === "KEY" ? "bg-purple-500/10 text-purple-400 border-purple-500/20" : "bg-blue-500/10 text-blue-400 border-blue-500/20"
                        }`}>
                          {g.granteeType}
                        </span>
                        <span className="text-muted-foreground truncate max-w-[120px]">{g.granteeId}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">{g.maxAmount ? `$${g.maxAmount}` : "—"}</td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {g.validFrom ? new Date(g.validFrom).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-muted-foreground">
                      {g.validUntil ? new Date(g.validUntil).toLocaleDateString() : "—"}
                    </td>
                    <td className="px-3 py-2.5">
                      {isRevoked ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">Revoked</span>
                      ) : isExpired ? (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-500/10 text-zinc-400 border border-zinc-500/20">Expired</span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Active</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      {!isRevoked && (
                        <Button
                          variant="subtle"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => setConfirmRevoke(g)}
                        >
                          <Trash2 className="w-3.5 h-3.5 text-red-400" />
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {grants.length === 0 && (
        <div className="kf-card p-8 text-center">
          <Shield className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
          <h3 className="text-sm font-medium mb-1">No Authority Grants</h3>
          <p className="text-xs text-muted-foreground">Create grants to delegate tier-4 authority.</p>
        </div>
      )}

      <Dialog open={showAdd} onClose={() => setShowAdd(false)} title="New Authority Grant">
        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Grantee Type</label>
            <select
              className="w-full rounded-lg border border-border/60 bg-[#111113] px-3 py-2 text-sm"
              value={newGrant.granteeType}
              onChange={(e) => setNewGrant((p) => ({ ...p, granteeType: e.target.value as "KEY" | "USER" }))}
            >
              <option value="USER">User</option>
              <option value="KEY">KEY</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Grantee ID</label>
            <Input
              placeholder="userId or key_ai"
              value={newGrant.granteeId ?? ""}
              onChange={(e) => setNewGrant((p) => ({ ...p, granteeId: e.target.value }))}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Scope</label>
            <select
              className="w-full rounded-lg border border-border/60 bg-[#111113] px-3 py-2 text-sm"
              value={newGrant.scope}
              onChange={(e) => setNewGrant((p) => ({ ...p, scope: e.target.value as "tier4_operations" | "tier4_financial" | "tier4_publishing" }))}
            >
              <option value="tier4_operations">Operations</option>
              <option value="tier4_financial">Financial</option>
              <option value="tier4_publishing">Publishing</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground block mb-1">Max Amount</label>
            <Input
              type="number"
              placeholder="Optional limit"
              value={newGrant.maxAmount?.toString() ?? ""}
              onChange={(e) => setNewGrant((p) => ({ ...p, maxAmount: e.target.value ? parseFloat(e.target.value) : undefined }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Valid From</label>
              <Input
                type="date"
                value={newGrant.validFrom ?? ""}
                onChange={(e) => setNewGrant((p) => ({ ...p, validFrom: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Valid Until</label>
              <Input
                type="date"
                value={newGrant.validUntil ?? ""}
                onChange={(e) => setNewGrant((p) => ({ ...p, validUntil: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="subtle" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={adding || !newGrant.granteeId}>
              {adding ? "Creating..." : "Create Grant"}
            </Button>
          </div>
        </div>
      </Dialog>

      <ConfirmDialog
        open={!!confirmRevoke}
        title="Revoke Grant"
        message="Are you sure you want to revoke this authority grant?"
        confirmLabel="Revoke"
        variant="danger"
        onConfirm={() => confirmRevoke && handleRevoke(confirmRevoke)}
        onCancel={() => setConfirmRevoke(null)}
      />
    </div>
  );
}
