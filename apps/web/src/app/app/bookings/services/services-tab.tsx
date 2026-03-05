"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Plus,
  Trash2,
  User,
  Mail,
  Clock,
  DollarSign,
  Edit3,
  Package,
  X,
  Check,
} from "lucide-react";
import type { Service, StaffMember } from "@/lib/client";
import {
  createService,
  updateService,
  deleteService,
  createStaff,
  deleteStaff,
} from "@/lib/client";

interface ServicesTabProps {
  businessId: string | null;
  services: Service[];
  staff: StaffMember[];
  setServices: React.Dispatch<React.SetStateAction<Service[]>>;
  setStaff: React.Dispatch<React.SetStateAction<StaffMember[]>>;
  loading: boolean;
}

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const item = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.3 } },
};

export default function ServicesTab({
  businessId,
  services,
  staff,
  setServices,
  setStaff,
  loading,
}: ServicesTabProps) {
  const [showServiceForm, setShowServiceForm] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [serviceForm, setServiceForm] = useState({ name: "", duration: 60, price: 0, description: "" });
  const [staffForm, setStaffForm] = useState({ name: "", email: "" });
  const [formError, setFormError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  function resetServiceForm() {
    setServiceForm({ name: "", duration: 60, price: 0, description: "" });
    setEditingService(null);
    setShowServiceForm(false);
    setFormError(null);
  }

  function openEditService(service: Service) {
    setServiceForm({
      name: service.name,
      duration: service.durationMins ?? service.duration ?? 60,
      price: service.price,
      description: service.description ?? "",
    });
    setEditingService(service);
    setShowServiceForm(true);
  }

  async function handleSaveService() {
    if (!businessId) return;
    setFormError(null);
    if (!serviceForm.name.trim()) { setFormError("Service name is required"); return; }
    if (serviceForm.price < 0) { setFormError("Price must be positive"); return; }
    setActionLoading(true);

    try {
      if (editingService) {
        const { data, error } = await updateService(editingService.id, {
          name: serviceForm.name,
          duration: serviceForm.duration,
          price: serviceForm.price,
          description: serviceForm.description || undefined,
        }, businessId);
        if (error) { setFormError(error); return; }
        if (data) {
          setServices((prev) => prev.map((s) => (s.id === editingService.id ? data : s)));
        }
      } else {
        const { data, error } = await createService({
          businessId,
          name: serviceForm.name,
          durationMins: serviceForm.duration,
          price: serviceForm.price,
          description: serviceForm.description || undefined,
        });
        if (error) { setFormError(error); return; }
        if (data) {
          setServices((prev) => [...prev, data]);
        }
      }
      resetServiceForm();
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteService(serviceId: string) {
    if (!businessId) return;
    const { error } = await deleteService(serviceId, businessId);
    if (!error) setServices((prev) => prev.filter((s) => s.id !== serviceId));
  }

  async function handleCreateStaff() {
    if (!businessId) return;
    setFormError(null);
    if (!staffForm.name.trim()) { setFormError("Staff name is required"); return; }
    setActionLoading(true);
    try {
      const { data, error } = await createStaff({ businessId, name: staffForm.name, email: staffForm.email || undefined });
      if (error) { setFormError(error); return; }
      if (data) {
        setStaff((prev) => [...prev, data]);
        setStaffForm({ name: "", email: "" });
      }
    } finally {
      setActionLoading(false);
    }
  }

  async function handleDeleteStaff(staffId: string) {
    if (!businessId) return;
    const { error } = await deleteStaff(staffId, businessId);
    if (!error) setStaff((prev) => prev.filter((s) => s.id !== staffId));
  }

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
            <h3 className="text-sm font-semibold">Services</h3>
            <span className="text-xs text-muted-foreground">({services.length})</span>
          </div>
          <button
            onClick={() => { resetServiceForm(); setShowServiceForm(true); }}
            className="kf-btn-primary inline-flex items-center gap-1.5 text-xs"
          >
            <Plus className="w-3.5 h-3.5" /> Add Service
          </button>
        </div>

        <AnimatePresence>
          {showServiceForm && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="kf-card-accent p-5 space-y-4 mb-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">
                    {editingService ? "Edit Service" : "New Service"}
                  </h4>
                  <button onClick={resetServiceForm} className="p-1 rounded hover:bg-muted/50">
                    <X className="w-4 h-4 text-muted-foreground" />
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Service Name</label>
                    <input
                      placeholder="e.g. Hair Cut"
                      value={serviceForm.name}
                      onChange={(e) => setServiceForm((f) => ({ ...f, name: e.target.value }))}
                      className="kf-input w-full"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Duration (minutes)</label>
                    <input
                      type="number"
                      min={5}
                      placeholder="60"
                      value={serviceForm.duration}
                      onChange={(e) => setServiceForm((f) => ({ ...f, duration: parseInt(e.target.value) || 0 }))}
                      className="kf-input w-full"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Price</label>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      placeholder="0.00"
                      value={serviceForm.price}
                      onChange={(e) => setServiceForm((f) => ({ ...f, price: parseFloat(e.target.value) || 0 }))}
                      className="kf-input w-full"
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1.5 block font-medium">Description (optional)</label>
                    <input
                      placeholder="Brief description"
                      value={serviceForm.description}
                      onChange={(e) => setServiceForm((f) => ({ ...f, description: e.target.value }))}
                      className="kf-input w-full"
                    />
                  </div>
                </div>
                {formError && (
                  <p className="text-xs text-red-400">{formError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={handleSaveService}
                    disabled={actionLoading}
                    className="kf-btn-primary inline-flex items-center gap-1.5 text-xs"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {editingService ? "Save Changes" : "Create Service"}
                  </button>
                  <button onClick={resetServiceForm} className="kf-btn-secondary text-xs">
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {services.length === 0 ? (
          <div className="kf-card p-8 text-center">
            <Package className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
            <p className="text-lg font-medium mb-1">No services yet</p>
            <p className="text-muted-foreground text-sm">
              {loading ? "Loading services..." : "Create services that clients can book."}
            </p>
          </div>
        ) : (
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
          >
            {services.map((service) => (
              <motion.div
                key={service.id}
                variants={item}
                className="kf-card p-4 group hover:ring-1 hover:ring-[hsl(var(--kf-accent1)/0.3)] transition-all"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        background: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.15), hsl(var(--kf-accent1) / 0.05))",
                        borderColor: "hsl(var(--kf-accent1) / 0.2)",
                        borderWidth: 1,
                      }}
                    >
                      <Package className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold truncate">{service.name}</h4>
                      {service.description && (
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">{service.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => openEditService(service)}
                      className="p-1.5 rounded-lg hover:bg-muted/50 transition-colors"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => handleDeleteService(service.id)}
                      className="p-1.5 rounded-lg hover:bg-red-500/10 hover:text-red-400 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {service.durationMins ?? service.duration ?? 60} min
                  </span>
                  <span className="flex items-center gap-1 font-medium text-foreground">
                    <DollarSign className="w-3 h-3" />
                    {service.price.toLocaleString("en-US", { minimumFractionDigits: 0 })}
                  </span>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>

      <div className="border-t border-border/40 pt-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <User className="w-4 h-4" style={{ color: "hsl(var(--kf-accent2))" }} />
            <h3 className="text-sm font-semibold">Staff</h3>
            <span className="text-xs text-muted-foreground">({staff.length})</span>
          </div>
        </div>

        <div className="kf-card-accent p-4 space-y-3 mb-4">
          <h4 className="text-xs font-semibold flex items-center gap-2">
            <Plus className="w-3.5 h-3.5" style={{ color: "hsl(var(--kf-accent2))" }} /> Add Staff Member
          </h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <input
                placeholder="Full Name"
                value={staffForm.name}
                onChange={(e) => setStaffForm((f) => ({ ...f, name: e.target.value }))}
                className="kf-input w-full text-sm"
              />
            </div>
            <div>
              <input
                placeholder="Email (optional)"
                value={staffForm.email}
                onChange={(e) => setStaffForm((f) => ({ ...f, email: e.target.value }))}
                className="kf-input w-full text-sm"
              />
            </div>
            <button
              onClick={handleCreateStaff}
              disabled={actionLoading}
              className="kf-btn-primary inline-flex items-center justify-center gap-1.5 text-xs"
            >
              <Plus className="w-3.5 h-3.5" /> Add Staff
            </button>
          </div>
        </div>

        {staff.length === 0 ? (
          <div className="kf-card p-6 text-center">
            <User className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm font-medium mb-1">No staff members</p>
            <p className="text-muted-foreground text-xs">
              {loading ? "Loading staff..." : "Add team members to assign them to bookings."}
            </p>
          </div>
        ) : (
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3"
          >
            {staff.map((s) => (
              <motion.div
                key={s.id}
                variants={item}
                className="kf-card p-4 group hover:ring-1 hover:ring-[hsl(var(--kf-accent2)/0.3)] transition-all"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className="h-10 w-10 rounded-full flex items-center justify-center text-lg font-bold"
                      style={{
                        background: "linear-gradient(135deg, hsl(var(--kf-accent2) / 0.15), hsl(var(--kf-accent2) / 0.05))",
                        borderColor: "hsl(var(--kf-accent2) / 0.2)",
                        borderWidth: 1,
                        color: "hsl(var(--kf-accent2))",
                      }}
                    >
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
                    onClick={() => handleDeleteStaff(s.id)}
                    className="p-1.5 rounded-lg opacity-0 group-hover:opacity-100 hover:bg-red-500/10 hover:text-red-400 transition-all"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </motion.div>
            ))}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
