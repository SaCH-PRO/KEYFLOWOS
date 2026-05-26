"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { getUserDisplayName } from "@/lib/workspace";
import { Sparkles } from "lucide-react";

export function CockpitHero({ preparedCount = 0 }: { preparedCount?: number }) {
  const name = getUserDisplayName();
  const firstName = name.split(" ")[0] || "there";
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const [typedText, setTypedText] = useState("");
  const fullText = "Let KEY handle the rest.";

  useEffect(() => {
    let i = 0;
    const timer = setInterval(() => {
      if (i <= fullText.length) {
        setTypedText(fullText.slice(0, i));
        i++;
      } else {
        clearInterval(timer);
      }
    }, 50);
    return () => clearInterval(timer);
  }, []);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="space-y-2 relative"
    >
      {/* Subtle background glow */}
      <div className="absolute -left-8 -top-8 w-48 h-48 bg-gradient-to-br from-orange-500/5 to-teal-500/5 rounded-full blur-3xl pointer-events-none" />
      
      <div className="flex items-center gap-2">
        <p className="text-sm text-muted-foreground">
          {greeting}, {firstName} 👋
        </p>
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 0.3, type: "spring", stiffness: 300 }}
        >
          <Sparkles className="w-4 h-4 text-[hsl(var(--kf-accent1))]" />
        </motion.div>
      </div>
      
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight leading-[1.15]">
        Your business is in flow.
        <br />
        <span className="text-gradient-key">
          {typedText}
          <span className="inline-block w-[2px] h-8 bg-[hsl(var(--kf-accent2))] ml-0.5 animate-pulse align-middle" />
        </span>
      </h1>
      
      {preparedCount > 0 && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="text-sm text-muted-foreground pt-1"
        >
          KEY has prepared{" "}
          <span className="font-semibold text-foreground">
            {preparedCount} action{preparedCount !== 1 ? "s" : ""}
          </span>{" "}
          that can move things forward today.
        </motion.p>
      )}
    </motion.div>
  );
}
