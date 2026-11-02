"use client";

import { useEffect, useState } from "react";
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

/**
 * R0-09g-D11-DOCUMENT-TEMPLATES: changing the default invoice or quote
 * template is OWNER only (owner ruling D-11; PATCH .../document-templates
 * answers a non-owner 403 BUSINESS_PROFILE_OWNER_ONLY). apiPatch returns a
 * refusal as `{ data: null, error, status }` rather than throwing, so a refused
 * change shows the server's refusal on the page (a 403 without a usable message
 * names the owner-only rule) and the stored default stays marked.
 */
const OWNER_ONLY_FALLBACK_TEXT = "Only the business owner can change the default document templates.";
const UPDATE_FAILED_TEXT = "Failed to update template";
const GENERIC_FORBIDDEN = new Set(["forbidden", "forbidden resource", "request failed"]);

function refusalText(res: { error: string | null; status?: number }): string {
  const message = res.error?.trim() ?? "";
  if (res.status === 403 && (!message || GENERIC_FORBIDDEN.has(message.toLowerCase()))) return OWNER_ONLY_FALLBACK_TEXT;
  return message || UPDATE_FAILED_TEXT;
}

export default function DocumentTemplatesPage() {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [branding, setBranding] = useState<{ primaryColor?: string; secondaryColor?: string; logoUrl?: string }>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const businessId = getStoredBusinessId();

  useEffect(() => {
    if (!businessId) return;
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
    setRefusal(null);
    const body = template.type === 'invoice'
      ? { invoiceTemplate: template.id as 'classic' | 'modern' | 'minimal' }
      : { quoteTemplate: template.id as 'classic' | 'modern' | 'minimal' };
    const res: { data: unknown; error: string | null; status?: number } = await setDocumentTemplate(body, businessId);
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
      // The stored default stays marked: templates state changes only on success.
      setRefusal(refusalText(res));
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

      {refusal && (
        <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          {refusal}
        </div>
      )}

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
      <div className="p-4" role="group" aria-label={`${template.name} ${template.type} template`}>
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
