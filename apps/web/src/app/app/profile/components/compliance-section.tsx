"use client";

import { useEffect, useState, useMemo } from "react";
import {
  Shield,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  FileText,
  CreditCard,
  Users,
  Lock,
  Save,
} from "lucide-react";
import { Button } from "@keyflow/ui";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { updateBusiness, getBusinessById } from "@/lib/client";
import { toast } from "sonner";
import { AccordionSection, AccordionGroup } from "../../store/components/accordion-section";

interface ComplianceItem {
  id: string;
  title: string;
  description: string;
  category: "legal" | "financial" | "data" | "operational";
  required: boolean;
  completed: boolean;
}

const COMPLIANCE_ITEMS: ComplianceItem[] = [
  { id: "business_registration", title: "Business Registration", description: "Register your business with the relevant government authority", category: "legal", required: true, completed: false },
  { id: "tax_registration", title: "Tax Registration", description: "Register for VAT/BIR and obtain your tax identification number", category: "financial", required: true, completed: false },
  { id: "privacy_policy", title: "Privacy Policy", description: "Create and publish a privacy policy for your customers", category: "data", required: true, completed: false },
  { id: "terms_of_service", title: "Terms of Service", description: "Create and publish terms of service for your business", category: "legal", required: true, completed: false },
  { id: "payment_processing", title: "Payment Processing Agreement", description: "Set up a compliant payment processing solution", category: "financial", required: true, completed: false },
  { id: "employee_contracts", title: "Employee/Contractor Contracts", description: "Have proper contracts in place for all team members", category: "operational", required: false, completed: false },
  { id: "insurance", title: "Business Insurance", description: "Obtain appropriate liability insurance for your business", category: "operational", required: false, completed: false },
  { id: "data_backup", title: "Data Backup & Recovery", description: "Implement regular data backup and disaster recovery procedures", category: "data", required: false, completed: false },
];

const categoryLabels: Record<string, { label: string; icon: React.ReactNode }> = {
  legal: { label: "Legal", icon: <FileText className="w-3.5 h-3.5" /> },
  financial: { label: "Financial", icon: <CreditCard className="w-3.5 h-3.5" /> },
  data: { label: "Data Protection", icon: <Lock className="w-3.5 h-3.5" /> },
  operational: { label: "Operational", icon: <Users className="w-3.5 h-3.5" /> },
};

interface ComplianceSectionProps {
  businessId: string | null;
  onStatus: (status: { type: "success" | "error"; message: string } | null) => void;
  onComplianceChange?: (completedCount: number, totalRequired: number) => void;
}

export default function ComplianceSection({ businessId, onStatus, onComplianceChange }: ComplianceSectionProps) {
  const [items, setItems] = useState<ComplianceItem[]>(COMPLIANCE_ITEMS);
  const [initialItems, setInitialItems] = useState<ComplianceItem[]>(COMPLIANCE_ITEMS);
  const [saving, setSaving] = useState(false);

  const isDirty = useMemo(() => JSON.stringify(items) !== JSON.stringify(initialItems), [items, initialItems]);

  const requiredCount = items.filter(i => i.required).length;
  const completedRequiredCount = items.filter(i => i.required && i.completed).length;
  const totalCompleted = items.filter(i => i.completed).length;

  useEffect(() => {
    onComplianceChange?.(completedRequiredCount, requiredCount);
  }, [completedRequiredCount, requiredCount, onComplianceChange]);

  useEffect(() => {
    if (!businessId) return;
    const load = async () => {
      try {
        const result = await getBusinessById(businessId);
        if (result?.data?.complianceData) {
          const cd = result.data.complianceData as Record<string, boolean>;
          const updated = COMPLIANCE_ITEMS.map(item => ({
            ...item,
            completed: cd[item.id] ?? false,
          }));
          setItems(updated);
          setInitialItems(updated);
        }
      } catch (err) {
        console.error("Failed to load compliance data:", err);
      }
    };
    load();
  }, [businessId]);

  const toggleItem = (itemId: string) => {
    setItems(prev => prev.map(item =>
      item.id === itemId ? { ...item, completed: !item.completed } : item
    ));
  };

  const calculateStatus = (): "GREEN" | "YELLOW" | "RED" => {
    const requiredItems = items.filter(i => i.required);
    const completedRequired = requiredItems.filter(i => i.completed).length;
    const allItems = items;
    const completedAll = allItems.filter(i => i.completed).length;
    if (completedRequired === requiredItems.length) {
      return completedAll >= allItems.length * 0.8 ? "GREEN" : "YELLOW";
    } else if (completedRequired >= requiredItems.length * 0.5) {
      return "YELLOW";
    }
    return "RED";
  };

  const handleSave = async () => {
    if (!businessId) return;
    setSaving(true);
    onStatus(null);
    try {
      const complianceData: Record<string, boolean> = {};
      items.forEach(item => { complianceData[item.id] = item.completed; });
      const status = calculateStatus();
      await updateBusiness({ businessId, complianceStatus: status, complianceData, lastHealthCheck: new Date().toISOString() });
      setInitialItems([...items]);
      onStatus({ type: "success", message: "Compliance status saved" });
      toast.success("Compliance status saved");
    } catch {
      onStatus({ type: "error", message: "Failed to save compliance status" });
      toast.error("Failed to save compliance status");
    }
    setSaving(false);
  };

  const status = calculateStatus();
  const statusColor = status === "GREEN" ? "hsl(var(--kf-success))" : status === "YELLOW" ? "hsl(var(--kf-warning))" : "hsl(var(--kf-error))";
  const statusLabel = status === "GREEN" ? "All Clear" : status === "YELLOW" ? "Needs Attention" : "Action Required";

  const categories = ["legal", "financial", "data", "operational"] as const;

  return (
    <AccordionGroup title="Compliance & Legal">
      <AccordionSection
        title="Compliance Checklist"
        subtitle={`${completedRequiredCount}/${requiredCount} required items complete — ${statusLabel}`}
        icon={Shield}
        accentColor={statusColor}
      >
        <div className="space-y-4 p-1">
          <div className="flex items-center gap-3 mb-2">
            <div className="flex-1">
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "hsl(var(--kf-muted) / 0.3)" }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${(totalCompleted / items.length) * 100}%`, background: statusColor }}
                />
              </div>
            </div>
            <span className="text-xs font-medium" style={{ color: statusColor }}>
              {totalCompleted}/{items.length}
            </span>
          </div>

          {categories.map(category => {
            const catItems = items.filter(i => i.category === category);
            const catInfo = categoryLabels[category];
            return (
              <div key={category}>
                <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-muted-foreground">
                  {catInfo.icon}
                  <span>{catInfo.label}</span>
                  <span className="ml-auto text-[10px]">
                    {catItems.filter(i => i.completed).length}/{catItems.length}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {catItems.map(item => (
                    <label
                      key={item.id}
                      className="flex items-start gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all min-h-[44px]"
                      style={{
                        borderColor: item.completed ? "hsl(var(--kf-success) / 0.2)" : "hsl(var(--kf-border) / 0.4)",
                        background: item.completed ? "hsl(var(--kf-success) / 0.04)" : "transparent",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={() => toggleItem(item.id)}
                        className="mt-0.5 rounded accent-[hsl(var(--kf-success))]"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium ${item.completed ? "line-through text-muted-foreground" : "text-foreground"}`}>
                            {item.title}
                          </span>
                          {item.required && !item.completed && (
                            <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: "hsl(var(--kf-error) / 0.1)", color: "hsl(var(--kf-error))" }}>
                              Required
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{item.description}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}

          {isDirty && (
            <div className="flex items-center justify-between pt-2 border-t border-border/30">
              <p className="text-xs flex items-center gap-1" style={{ color: "hsl(var(--kf-warning))" }}>
                <AlertCircle className="h-3 w-3" />
                Unsaved changes
              </p>
              <Button onClick={handleSave} disabled={saving} className="min-h-[44px]">
                <Save className="h-3.5 w-3.5 mr-1.5" />
                {saving ? "Saving..." : "Save"}
              </Button>
            </div>
          )}
        </div>
      </AccordionSection>
    </AccordionGroup>
  );
}
