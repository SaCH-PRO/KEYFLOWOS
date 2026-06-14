"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Sparkles, ArrowRight, Loader2, Settings } from "lucide-react";
import { apiGet } from "@/lib/api";
import { getStoredBusinessId } from "@/lib/workspace";
import { BlueprintOnboardingChat } from "../profile/components/blueprint-onboarding-chat";

export default function OnboardingPage() {
  const router = useRouter();
  const [businessId, setBusinessId] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [completeness, setCompleteness] = useState(0);

  useEffect(() => {
    const bid = getStoredBusinessId();
    if (!bid) {
      setChecking(false);
      return;
    }
    setBusinessId(bid);
    apiGet<{ completeness: number }>(`/blueprint/businesses/${bid}`)
      .then(({ data }) => {
        if (data) setCompleteness(data.completeness || 0);
      })
      .finally(() => setChecking(false));
  }, []);

  if (checking) {
    return (
      <div className="max-w-2xl mx-auto py-12 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin" style={{ color: "hsl(var(--kf-accent1))" }} />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-6 sm:py-8 space-y-6">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center space-y-3"
      >
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
          style={{ background: "hsl(var(--kf-accent1) / 0.1)" }}
        >
          <Sparkles className="w-8 h-8" style={{ color: "hsl(var(--kf-accent1))" }} />
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold">
          {completeness >= 80 ? "Your Business Genome is shaping up" : "Let's build your Business Genome"}
        </h1>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Spend a few minutes talking with KEY. The more it knows about your business, the better it can
          run as your digital co-founder.
        </p>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="kf-card p-4 sm:p-6"
        style={{
          background: "hsl(var(--kf-card))",
          border: "1px solid hsl(var(--kf-border) / 0.3)",
        }}
      >
        <BlueprintOnboardingChat
          businessId={businessId ?? undefined}
          fullPage={false}
          onComplete={() => {
            router.push("/app/command-center");
          }}
        />
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="flex flex-col sm:flex-row items-center justify-center gap-4 text-xs text-muted-foreground"
      >
        <a
          href="/app/blueprint"
          className="flex items-center gap-1.5 hover:text-foreground transition-colors"
        >
          <Settings className="w-3.5 h-3.5" />
          Prefer manual setup?
        </a>
        {completeness >= 40 && (
          <button
            onClick={() => router.push("/app/command-center")}
            className="flex items-center gap-1.5 hover:text-foreground transition-colors"
          >
            Skip for now
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        )}
      </motion.div>
    </div>
  );
}
