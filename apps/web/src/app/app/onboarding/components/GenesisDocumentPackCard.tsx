"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { FileText, Plus, AlertCircle, CheckCircle2, Loader2, ExternalLink } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { getStoredBusinessId } from "@/lib/workspace";
import type { BlueprintData, GeneratedDoc, GenesisDocumentPackResult } from "@/lib/blueprint-types";
import { generateDocumentPack, getDocumentPack, submitAnswers } from "@/lib/api/business-genesis";
import { LegalDisclaimerModal } from "./LegalDisclaimerModal";

interface GenesisDocumentPackCardProps {
  blueprint?: BlueprintData | null;
}

const SLUG_LABELS: Record<string, string> = {
  "registration-checklist-tt": "Trinidad & Tobago Business Registration Checklist",
  "legal-readiness-checklist": "Legal Readiness Checklist",
  "privacy-policy": "Privacy Policy",
  "website-terms": "Website Terms of Use",
  "service-agreement": "Service Agreement",
  "offer-letter": "Employment Offer Letter",
  "employee-handbook": "Employee Handbook",
  "nda-employee": "Employee Confidentiality Agreement",
  "founder-agreement": "Founder Agreement",
  "shareholder-agreement": "Shareholder Agreement",
  "contractor-agreement": "Independent Contractor Agreement",
};

function labelForMissing(slug: string): string {
  return SLUG_LABELS[slug] || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function GenesisDocumentPackCard({ blueprint }: GenesisDocumentPackCardProps) {
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [pack, setPack] = useState<GenesisDocumentPackResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showDisclaimer, setShowDisclaimer] = useState(false);

  const [localDisclaimerAccepted, setLocalDisclaimerAccepted] = useState(false);
  const disclaimerAccepted = !!blueprint?.legalProfile?.disclaimerAcceptedAt || localDisclaimerAccepted;

  useEffect(() => {
    setBusinessId(getStoredBusinessId());
  }, []);

  const loadPack = useCallback(async () => {
    const bid = businessId;
    if (!bid) return;
    setLoading(true);
    const { data } = await getDocumentPack(bid);
    if (data) setPack(data);
    setLoading(false);
  }, [businessId]);

  useEffect(() => {
    void loadPack();
  }, [loadPack]);

  const handleGenerate = async () => {
    if (!businessId) return;
    setGenerating(true);
    const { data, error } = await generateDocumentPack(businessId);
    setGenerating(false);
    if (error || !data) {
      toast.error(error || "Could not generate document pack.");
      return;
    }
    setPack(data);
    toast.success(`Generated ${data.generated.length} document${data.generated.length === 1 ? "" : "s"}.`);
  };

  const handleAcceptDisclaimer = async () => {
    if (!businessId) return;
    setGenerating(true);
    const { error } = await submitAnswers(businessId, {
      "legalProfile.disclaimerAcceptedAt": new Date().toISOString(),
    });
    if (error) {
      toast.error(error);
      setGenerating(false);
      return;
    }
    setLocalDisclaimerAccepted(true);
    setShowDisclaimer(false);
    await handleGenerate();
  };

  const handleRequestGenerate = () => {
    if (disclaimerAccepted) {
      void handleGenerate();
    } else {
      setShowDisclaimer(true);
    }
  };

  const generated = pack?.generated ?? [];
  const missing = pack?.missing ?? [];
  const profileDocs = blueprint?.documentProfile?.generatedDocuments ?? [];
  const sources = generated.length > 0 ? generated : profileDocs.map(
    (d): GeneratedDoc => ({
      instanceId: d.instanceId,
      documentTypeSlug: d.documentTypeSlug,
      title: d.title,
      status: "DRAFT",
      createdAt: d.generatedAt,
    }),
  );
  const missingSource = missing.length > 0 ? missing : blueprint?.documentProfile?.missingDocuments ?? [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="kf-card p-4 space-y-4"
      style={{ border: "1px solid hsl(var(--kf-border) / 0.3)" }}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <FileText className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
          Legal document pack
        </h3>
        {!loading && sources.length > 0 && (
          <span className="text-xs font-medium text-muted-foreground">
            {sources.length} generated
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading documents...
        </div>
      ) : (
        <>
          {sources.length === 0 && missingSource.length === 0 ? (
            <div className="text-sm text-muted-foreground py-2">
              No documents generated yet. Generate a starter pack tailored to your business.
            </div>
          ) : (
            <div className="space-y-3">
              {sources.length > 0 && (
                <ul className="space-y-2">
                  {sources.map((doc) => (
                    <li key={doc.instanceId}>
                      <Link
                        href={`/app/documents/${doc.instanceId}`}
                        className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors group"
                      >
                        <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{doc.title}</p>
                          <p className="text-[11px] text-muted-foreground capitalize">
                            {doc.documentTypeSlug.replace(/-/g, " ")} · {doc.status.toLowerCase()}
                          </p>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              {missingSource.length > 0 && (
                <div className="p-3 rounded-lg bg-[hsl(var(--kf-warning)/0.08)] border border-[hsl(var(--kf-warning)/0.2)] space-y-2">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: "hsl(var(--kf-warning))" }} />
                    <p className="text-sm font-medium">Missing document types</p>
                  </div>
                  <ul className="space-y-1 pl-6">
                    {missingSource.map((slug) => (
                      <li key={slug} className="text-xs text-muted-foreground">
                        {labelForMissing(slug)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {!disclaimerAccepted && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>You must accept the legal disclaimer before generating documents.</span>
            </div>
          )}

          <div className="flex justify-end pt-1">
            <button
              onClick={handleRequestGenerate}
              disabled={generating}
              className="kf-btn-primary flex items-center gap-2 px-4 py-2 text-xs"
            >
              {generating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Generating...
                </>
              ) : sources.length > 0 ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Regenerate pack
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  Generate document pack
                </>
              )}
            </button>
          </div>
        </>
      )}

      <LegalDisclaimerModal
        open={showDisclaimer}
        onAccept={handleAcceptDisclaimer}
        onCancel={() => setShowDisclaimer(false)}
        loading={generating}
      />
    </motion.div>
  );
}
