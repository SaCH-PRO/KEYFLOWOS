"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { fetchDocumentTemplates, setDocumentTemplate } from "@/lib/client";
import { Card } from "@keyflow/ui";
import { Button } from "@keyflow/ui";
import { FileText, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";

interface DocumentTemplate {
  id: string;
  type: string;
  name: string;
  isDefault: boolean;
}

export default function DocumentTemplatesPage() {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [branding, setBranding] = useState<{ primaryColor?: string; secondaryColor?: string; logoUrl?: string }>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const businessId = getStoredBusinessId();

  useEffect(() => {
    if (!businessId) return;
    setLoading(true);
    fetchDocumentTemplates(businessId).then((res) => {
      if (res.data) {
        setTemplates(res.data.templates ?? []);
        setBranding(res.data.branding ?? {});
      }
      setLoading(false);
    });
  }, [businessId]);

  const handleSetDefault = async (template: DocumentTemplate) => {
    if (!businessId) return;
    setSaving(`${template.type}-${template.id}`);
    const body = template.type === 'invoice'
      ? { invoiceTemplate: template.id as any }
      : { quoteTemplate: template.id as any };
    const res = await setDocumentTemplate(body, businessId);
    setSaving(null);
    if (res.data) {
      toast.success(`${template.name} set as default ${template.type} template`);
      setTemplates((prev) =>
        prev.map((t) =>
          t.type === template.type
            ? { ...t, isDefault: t.id === template.id }
            : t
        )
      );
    } else {
      toast.error(res.error ?? "Failed to update template");
    }
  };

  if (loading) return <div className="p-4">Loading templates...</div>;

  const invoiceTemplates = templates.filter((t) => t.type === "invoice");
  const quoteTemplates = templates.filter((t) => t.type === "quote");

  return (
    <div className="space-y-6 p-4">
      <div>
        <h2 className="text-xl font-semibold">Document Templates</h2>
        <p className="text-sm text-muted-foreground">
          Choose the default look for invoices and quotes sent to customers.
        </p>
      </div>

      {branding.primaryColor && (
        <div className="flex items-center gap-3 text-sm">
          <span className="text-muted-foreground">Brand colors:</span>
          <div className="flex items-center gap-1">
            <div className="h-4 w-4 rounded border" style={{ background: branding.primaryColor }} />
            <span>{branding.primaryColor}</span>
          </div>
          {branding.secondaryColor && (
            <div className="flex items-center gap-1">
              <div className="h-4 w-4 rounded border" style={{ background: branding.secondaryColor }} />
              <span>{branding.secondaryColor}</span>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Invoice Templates</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {invoiceTemplates.map((t) => (
            <TemplateCard
              key={`inv-${t.id}`}
              template={t}
              saving={saving === `invoice-${t.id}`}
              onSetDefault={() => handleSetDefault(t)}
            />
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Quote Templates</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {quoteTemplates.map((t) => (
            <TemplateCard
              key={`quo-${t.id}`}
              template={t}
              saving={saving === `quote-${t.id}`}
              onSetDefault={() => handleSetDefault(t)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  saving,
  onSetDefault,
}: {
  template: DocumentTemplate;
  saving: boolean;
  onSetDefault: () => void;
}) {
  return (
    <Card>
      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">{template.name}</span>
          </div>
          {template.isDefault && (
            <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">
              <Check className="h-3 w-3" />
              Default
            </span>
          )}
        </div>
        <p className="mt-1 text-xs text-muted-foreground capitalize">{template.type}</p>
        {!template.isDefault && (
          <Button size="sm" variant="ghost" className="mt-3" onClick={onSetDefault} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Set as default
          </Button>
        )}
      </div>
    </Card>
  );
}
