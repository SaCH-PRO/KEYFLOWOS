"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { apiGet } from "@/lib/api";

interface DocumentTemplate {
  id: string;
  type: string;
  name: string;
  isDefault: boolean;
  createdAt: string;
}

export default function DocumentTemplatesPage() {
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const searchParams = useSearchParams();
  const businessId = "cmoc2y1mq00009z0o8irkxj1u"; // TODO: from auth context

  useEffect(() => {
    apiGet<DocumentTemplate[]>(`/commerce/document-templates/businesses/${businessId}`).then((res) => {
      setTemplates(res.data ?? []);
      setLoading(false);
    });
  }, [businessId]);

  if (loading) return <div className="p-4">Loading templates...</div>;

  return (
    <div className="space-y-4 p-4">
      <h2 className="text-xl font-semibold">Document Templates</h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {templates.map((t) => (
          <div key={t.id} className="rounded-lg border p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-medium">{t.name}</span>
              {t.isDefault && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">Default</span>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{t.type}</p>
          </div>
        ))}
      </div>
      {templates.length === 0 && (
        <p className="text-muted-foreground">No custom templates yet. Create your first template to customize invoice and quote branding.</p>
      )}
    </div>
  );
}
