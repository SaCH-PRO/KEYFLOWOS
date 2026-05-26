"use client";

import { HelpCircle } from "lucide-react";
import { motion } from "framer-motion";
import { openKey } from "@/components/key/key-agent";

interface PageHelpButtonProps {
  /** Which module/workspace the user is in */
  module: string;
  /** What this page does */
  pageTitle: string;
  /** Optional: what actions are available */
  availableActions?: string[];
  /** Optional: current page state (filters, selected items, etc) */
  pageContext?: Record<string, unknown>;
  /** Position variant */
  position?: "bottom-right" | "bottom-left" | "top-right";
}

export function PageHelpButton({
  module,
  pageTitle,
  availableActions = [],
  pageContext,
  position = "bottom-right",
}: PageHelpButtonProps) {
  const positionClasses = {
    "bottom-right": "bottom-6 right-6",
    "bottom-left": "bottom-6 left-6",
    "top-right": "top-20 right-6",
  };

  const handleClick = () => {
    openKey({
      mode: "chat",
      prompt: ``,
      module: module as any,
      context: {
        helpRequest: true,
        pageTitle,
        availableActions,
        ...pageContext,
      },
    });
  };

  return (
    <motion.button
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.95 }}
      onClick={handleClick}
      className={`fixed ${positionClasses[position]} z-40 w-11 h-11 rounded-full bg-[hsl(var(--kf-accent1))] text-white shadow-lg shadow-[hsl(var(--kf-accent1))]/20 hover:shadow-xl hover:shadow-[hsl(var(--kf-accent1))]/30 flex items-center justify-center transition-shadow group`}
      title={`Ask KEY about ${pageTitle}`}
    >
      <HelpCircle className="w-5 h-5 group-hover:rotate-12 transition-transform" />
      {/* Subtle ring animation */}
      <span className="absolute inset-0 rounded-full border border-[hsl(var(--kf-accent1))]/40 animate-ping opacity-20" />
    </motion.button>
  );
}
