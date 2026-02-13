"use client";

import { motion } from "framer-motion";
import {
  Plus,
  Trash2,
  User,
  Mail,
} from "lucide-react";
import type { StaffMember } from "./bookings-types";

interface StaffPanelProps {
  staff: StaffMember[];
  staffForm: { name: string; email: string };
  setStaffForm: (fn: (f: { name: string; email: string }) => { name: string; email: string }) => void;
  onCreateStaff: () => void;
  onDeleteStaff: (staffId: string) => void;
  loading: boolean;
  formError: string | null;
}

export default function StaffPanel({
  staff,
  staffForm,
  setStaffForm,
  onCreateStaff,
  onDeleteStaff,
  loading,
}: StaffPanelProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="space-y-4"
    >
      <div className="kf-card-accent p-5 space-y-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Plus className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} /> Add Staff Member
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Full Name</label>
            <input
              placeholder="Jane Doe"
              value={staffForm.name}
              onChange={(e) => setStaffForm((f) => ({ ...f, name: e.target.value }))}
              className="kf-input w-full"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Email (optional)</label>
            <input
              placeholder="jane@example.com"
              value={staffForm.email}
              onChange={(e) => setStaffForm((f) => ({ ...f, email: e.target.value }))}
              className="kf-input w-full"
            />
          </div>
        </div>
        <button onClick={onCreateStaff} className="kf-btn-primary inline-flex items-center gap-2">
          <Plus className="w-4 h-4" /> Add Staff
        </button>
      </div>

      {staff.length === 0 ? (
        <div className="kf-card p-8 text-center">
          <User className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-lg font-medium mb-1">No staff members</p>
          <p className="text-muted-foreground">
            {loading ? "Loading staff..." : "Add team members to assign them to bookings."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {staff.map((s, index) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="kf-card p-4 group hover:ring-1 hover:ring-[hsl(var(--kf-accent2)/0.3)] transition-all"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full flex items-center justify-center text-lg font-bold" style={{ background: "linear-gradient(135deg, hsl(var(--kf-accent2) / 0.15), hsl(var(--kf-accent2) / 0.05))", borderColor: "hsl(var(--kf-accent2) / 0.2)", borderWidth: 1, color: "hsl(var(--kf-accent2))" }}>
                    {s.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h4 className="text-sm font-semibold">{s.name}</h4>
                    {s.email && (
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Mail className="w-3 h-3" /> {s.email}
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => onDeleteStaff(s.id)}
                  className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400 transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </motion.div>
  );
}
