"use client";

import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { Surface } from "@/components/ui-v2/surface";
import { Badge } from "@/components/ui-v2/badge";
import { Button } from "@/components/ui-v2/button";
import type { Banner } from "./store-types";

interface StoreBannerProps {
  banner: Banner | null;
  onDismiss: () => void;
}

const badgeColor = {
  success: "mint" as const,
  error: "rose" as const,
  warning: "gold" as const,
  info: "sky" as const,
};

export function StoreBanner({ banner, onDismiss }: StoreBannerProps) {
  return (
    <AnimatePresence>
      {banner && (
        <motion.div
          initial={{ opacity: 0, y: -5 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
        >
          <Surface
            variant="default"
            className={`p-3 text-sm flex items-center gap-3 ${
              banner.type === "success"
                ? "border-mint/30 bg-mint/10 text-mint"
                : banner.type === "error"
                ? "border-rose/30 bg-rose/10 text-rose"
                : banner.type === "warning"
                ? "border-gold/40 bg-gold/15 text-gold-foreground"
                : "border-sky/30 bg-sky/10 text-sky"
            }`}
          >
            {banner.type === "success" ? (
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
            )}
            <Badge variant="status" color={badgeColor[banner.type]}>
              {banner.type}
            </Badge>
            <span className="text-body text-foreground flex-1">{banner.text}</span>
            <Button variant="ghost" onClick={onDismiss} className="ml-auto h-8 text-xs">
              Dismiss
            </Button>
          </Surface>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
