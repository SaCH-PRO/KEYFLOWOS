"use client";

import { useEffect, useState, useMemo } from "react";
import { motion } from "framer-motion";
import { refreshWorkspace, getStoredBusinessId } from "@/lib/workspace";
import { updateBusiness, getBusinessById } from "@/lib/client";
import { useUnsavedChanges } from "@/hooks/use-unsaved-changes";
import { 
  Shield, 
  CheckCircle2, 
  AlertTriangle, 
  AlertCircle,
  FileText,
  Building2,
  CreditCard,
  Users,
  Lock,
  Save,
} from "lucide-react";

interface ComplianceItem {
  id: string;
  title: string;
  description: string;
  category: "legal" | "financial" | "data" | "operational";
  required: boolean;
  completed: boolean;
}

const COMPLIANCE_ITEMS: ComplianceItem[] = [
  {
    id: "business_registration",
    title: "Business Registration",
    description: "Register your business with the relevant government authority",
    category: "legal",
    required: true,
    completed: false,
  },
  {
    id: "tax_registration",
    title: "Tax Registration",
    description: "Register for VAT/BIR and obtain your tax identification number",
    category: "financial",
    required: true,
    completed: false,
  },
  {
    id: "privacy_policy",
    title: "Privacy Policy",
    description: "Create and publish a privacy policy for your customers",
    category: "data",
    required: true,
    completed: false,
  },
  {
    id: "terms_of_service",
    title: "Terms of Service",
    description: "Create and publish terms of service for your business",
    category: "legal",
    required: true,
    completed: false,
  },
  {
    id: "payment_processing",
    title: "Payment Processing Agreement",
    description: "Set up a compliant payment processing solution",
    category: "financial",
    required: true,
    completed: false,
  },
  {
    id: "employee_contracts",
    title: "Employee/Contractor Contracts",
    description: "Have proper contracts in place for all team members",
    category: "operational",
    required: false,
    completed: false,
  },
  {
    id: "insurance",
    title: "Business Insurance",
    description: "Obtain appropriate liability insurance for your business",
    category: "operational",
    required: false,
    completed: false,
  },
  {
    id: "data_backup",
    title: "Data Backup & Recovery",
    description: "Implement regular data backup and disaster recovery procedures",
    category: "data",
    required: false,
    completed: false,
  },
];

const categoryIcons: Record<string, React.ReactNode> = {
  legal: <FileText className="w-4 h-4" />,
  financial: <CreditCard className="w-4 h-4" />,
  data: <Lock className="w-4 h-4" />,
  operational: <Users className="w-4 h-4" />,
};

const statusConfig = {
  GREEN: {
    label: "All Clear",
    description: "All required compliance items are complete",
    color: "text-green-500",
    bgColor: "bg-green-500/10",
    borderColor: "border-green-500/30",
    icon: <CheckCircle2 className="w-6 h-6" />,
  },
  YELLOW: {
    label: "Needs Attention",
    description: "Some compliance items need your attention",
    color: "text-amber-500",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/30",
    icon: <AlertTriangle className="w-6 h-6" />,
  },
  RED: {
    label: "Urgent Action Required",
    description: "Critical compliance items are incomplete",
    color: "text-red-500",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-500/30",
    icon: <AlertCircle className="w-6 h-6" />,
  },
};

export default function ComplianceSettingsPage() {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [items, setItems] = useState<ComplianceItem[]>(COMPLIANCE_ITEMS);
  const [initialItems, setInitialItems] = useState<ComplianceItem[]>(COMPLIANCE_ITEMS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const isDirty = useMemo(() => JSON.stringify(items) !== JSON.stringify(initialItems), [items, initialItems]);
  useUnsavedChanges(isDirty);

  useEffect(() => {
    const init = async () => {
      let bizId: string | null = null;
      const fresh = await refreshWorkspace();
      if (fresh) {
        setBusinessId(fresh);
        bizId = fresh;
      } else {
        const stored = getStoredBusinessId();
        if (stored) {
          setBusinessId(stored);
          bizId = stored;
        }
      }

      if (bizId) {
        try {
          const result = await getBusinessById(bizId);
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
          console.error("Failed to load compliance data from backend:", err);
        }
      }

      setLoading(false);
    };
    void init();
  }, []);

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
    setSavedMessage(null);

    try {
      const complianceData: Record<string, boolean> = {};
      items.forEach(item => {
        complianceData[item.id] = item.completed;
      });

      const status = calculateStatus();

      await updateBusiness({
        businessId,
        complianceStatus: status,
        complianceData: complianceData,
        lastHealthCheck: new Date().toISOString(),
      });

      setInitialItems([...items]);
      setSavedMessage("Compliance status saved successfully!");
      setTimeout(() => setSavedMessage(null), 3000);
    } catch (err) {
      console.error("Failed to save compliance status:", err);
      setSavedMessage("Failed to save. Please try again.");
    }

    setSaving(false);
  };

  const status = calculateStatus();
  const statusInfo = statusConfig[status];
  const requiredCount = items.filter(i => i.required).length;
  const completedRequiredCount = items.filter(i => i.required && i.completed).length;
  const totalCompleted = items.filter(i => i.completed).length;

  const groupedItems = {
    legal: items.filter(i => i.category === "legal"),
    financial: items.filter(i => i.category === "financial"),
    data: items.filter(i => i.category === "data"),
    operational: items.filter(i => i.category === "operational"),
  };

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="space-y-2">
          <div className="h-5 w-44 bg-muted/40 rounded-lg" />
          <div className="h-3 w-72 bg-muted/30 rounded-lg" />
        </div>
        <div className="kf-card p-5 space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="space-y-1.5">
                <div className="h-4 w-36 bg-muted/30 rounded" />
                <div className="h-3 w-52 bg-muted/20 rounded" />
              </div>
              <div className="h-8 w-24 bg-muted/30 rounded-lg" />
            </div>
          ))}
        </div>
        <div className="kf-card p-5 space-y-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="space-y-1.5">
                <div className="h-4 w-32 bg-muted/30 rounded" />
                <div className="h-3 w-48 bg-muted/20 rounded" />
              </div>
              <div className="h-8 w-24 bg-muted/30 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className={`kf-card p-6 ${statusInfo.bgColor} ${statusInfo.borderColor} border`}
      >
        <div className="flex items-center gap-4">
          <div className={`p-3 rounded-xl ${statusInfo.bgColor}`}>
            <div className={statusInfo.color}>{statusInfo.icon}</div>
          </div>
          <div className="flex-1">
            <h2 className={`text-xl font-bold ${statusInfo.color}`}>
              {statusInfo.label}
            </h2>
            <p className="text-muted-foreground">{statusInfo.description}</p>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold">{completedRequiredCount}/{requiredCount}</div>
            <div className="text-xs text-muted-foreground">Required items complete</div>
          </div>
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between text-sm mb-1">
            <span>Overall Progress</span>
            <span>{totalCompleted}/{items.length} items</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div 
              className={`h-full transition-all ${status === "GREEN" ? "bg-green-500" : status === "YELLOW" ? "bg-amber-500" : "bg-red-500"}`}
              style={{ width: `${(totalCompleted / items.length) * 100}%` }}
            />
          </div>
        </div>
      </motion.div>

      <div className="grid gap-6 md:grid-cols-2">
        {Object.entries(groupedItems).map(([category, categoryItems], idx) => (
          <motion.div
            key={category}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 + idx * 0.05 }}
            className="kf-card p-4"
          >
            <div className="flex items-center gap-2 mb-4 capitalize">
              {categoryIcons[category]}
              <h3 className="font-semibold">{category}</h3>
              <span className="text-xs text-muted-foreground ml-auto">
                {categoryItems.filter(i => i.completed).length}/{categoryItems.length}
              </span>
            </div>
            <div className="space-y-3">
              {categoryItems.map(item => (
                <label
                  key={item.id}
                  className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${
                    item.completed 
                      ? "bg-green-500/5 border-green-500/20" 
                      : "border-border/50 hover:border-border"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={item.completed}
                    onChange={() => toggleItem(item.id)}
                    className="mt-1 rounded border-border"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${item.completed ? "line-through text-muted-foreground" : ""}`}>
                        {item.title}
                      </span>
                      {item.required && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/10 text-red-500">
                          Required
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                  </div>
                </label>
              ))}
            </div>
          </motion.div>
        ))}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="flex items-center justify-between p-4 kf-card"
      >
        {savedMessage && (
          <div className={`text-sm ${savedMessage.includes("Failed") ? "text-red-500" : "text-green-500"}`}>
            {savedMessage}
          </div>
        )}
        <div className="ml-auto">
          <button
            onClick={handleSave}
            disabled={saving}
            className="kf-btn-primary flex items-center gap-2"
          >
            <Save className="w-4 h-4" />
            {saving ? "Saving..." : "Save Compliance Status"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
