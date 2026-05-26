"use client";

import React, { useEffect, useRef, useState } from "react";
import ReactDOM from "react-dom";
import { InvoiceTemplateRenderer } from "./invoice-templates/template-renderer";
import type { TemplateId, InvoiceTemplateData } from "./invoice-templates/template-types";
import { buildPrintHtml } from "./invoice-templates/print-document";
import { useDriveUpload } from "@/hooks/use-drive-upload";
import type { BusinessDataForPreview } from "./billing-detail-modal";

interface InvoiceDriveUploaderProps {
  businessId: string;
  invoiceId: string;
  docType: "invoice" | "quote";
  templateId: TemplateId;
  templateData: InvoiceTemplateData;
  fileName: string;
  onComplete?: (success: boolean) => void;
}

/**
 * Renders an invoice/quote template in a hidden div, captures the HTML,
 * and uploads it to Google Drive as a Google Doc.
 *
 * This component destroys itself after upload (no UI rendered).
 */
export function InvoiceDriveUploader({
  businessId,
  invoiceId,
  docType,
  templateId,
  templateData,
  fileName,
  onComplete,
}: InvoiceDriveUploaderProps) {
  const hiddenRef = useRef<HTMLDivElement | null>(null);
  const [htmlReady, setHtmlReady] = useState(false);
  const { uploadToDrive } = useDriveUpload();
  const uploadedRef = useRef(false);

  // Render the template into a hidden div
  useEffect(() => {
    if (!hiddenRef.current || htmlReady) return;

    const container = document.createElement("div");
    container.style.position = "absolute";
    container.style.left = "-9999px";
    container.style.top = "0";
    container.style.width = "794px";
    document.body.appendChild(container);

    ReactDOM.render(
      <InvoiceTemplateRenderer templateId={templateId} data={templateData} />,
      container,
      () => {
        // After React renders, capture the HTML
        setTimeout(() => {
          const innerHtml = container.innerHTML;
          document.body.removeChild(container);

          // Store the HTML on the ref for the upload effect
          if (hiddenRef.current) {
            (hiddenRef.current as any).__capturedHtml = innerHtml;
            setHtmlReady(true);
          }
        }, 500);
      },
    );

    return () => {
      try {
        if (document.body.contains(container)) {
          ReactDOM.unmountComponentAtNode(container);
          document.body.removeChild(container);
        }
      } catch {
        // ignore
      }
    };
  }, [templateId, templateData, htmlReady]);

  // Upload to Drive once HTML is ready
  useEffect(() => {
    if (!htmlReady || uploadedRef.current) return;
    const capturedHtml = (hiddenRef.current as any)?.__capturedHtml;
    if (!capturedHtml) return;

    uploadedRef.current = true;
    const fullHtml = buildPrintHtml(capturedHtml, fileName);

    uploadToDrive({
      businessId,
      entityType: docType,
      entityId: invoiceId,
      fileName,
      mimeType: "text/html",
      content: fullHtml,
      contentFormat: "html",
      silent: true,
    }).then((success) => {
      onComplete?.(success);
    });
  }, [htmlReady, businessId, invoiceId, docType, fileName, uploadToDrive, onComplete]);

  return <div ref={hiddenRef} style={{ display: "none" }} />;
}

/**
 * Build InvoiceTemplateData from raw invoice/quote data for Drive upload.
 */
export function buildTemplateData(
  docType: "invoice" | "quote",
  data: {
    id: string;
    number: string;
    status: string;
    issueDate?: string | null;
    dueDate?: string | null;
    expiryDate?: string | null;
    contact: {
      firstName?: string | null;
      lastName?: string | null;
      email?: string | null;
      phone?: string | null;
    } | null;
    items: Array<{
      id?: string;
      description?: string | null;
      quantity?: number;
      unitPrice?: number;
      total?: number;
    }>;
    subtotal: number;
    taxRate?: number;
    taxAmount: number;
    discountType?: string | null;
    discountValue?: number | null;
    discountAmount: number;
    total: number;
    currency: string;
    notes?: string | null;
  },
  businessData: BusinessDataForPreview,
): InvoiceTemplateData {
  return {
    type: docType,
    number: data.number,
    status: data.status,
    issueDate: data.issueDate ?? null,
    dueDate: docType === "invoice" ? (data.dueDate ?? null) : null,
    expiryDate: docType === "quote" ? (data.expiryDate ?? null) : null,
    contact: data.contact,
    items: data.items,
    subtotal: data.subtotal,
    taxRate: data.taxRate ?? 0,
    taxAmount: data.taxAmount,
    discountType: data.discountType ?? null,
    discountValue: data.discountValue ?? null,
    discountAmount: data.discountAmount,
    total: data.total,
    currency: data.currency,
    notes: data.notes ?? null,
    business: {
      name: businessData.name,
      logoUrl: businessData.logoUrl || null,
      address: businessData.address,
      city: businessData.city,
      country: businessData.country,
      phone: businessData.phone,
      email: businessData.email,
      website: businessData.website,
      tagline: businessData.tagline,
      primaryColor: businessData.primaryColor,
      secondaryColor: businessData.secondaryColor,
    },
  };
}
