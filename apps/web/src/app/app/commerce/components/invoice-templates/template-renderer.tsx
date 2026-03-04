"use client";

import type { TemplateId, InvoiceTemplateData } from "./template-types";
import { ClassicTemplate } from "./classic-template";
import { ModernTemplate } from "./modern-template";
import { MinimalTemplate } from "./minimal-template";

interface Props {
  templateId: TemplateId;
  data: InvoiceTemplateData;
}

export function InvoiceTemplateRenderer({ templateId, data }: Props) {
  switch (templateId) {
    case "modern":
      return <ModernTemplate data={data} />;
    case "minimal":
      return <MinimalTemplate data={data} />;
    case "classic":
    default:
      return <ClassicTemplate data={data} />;
  }
}
