"use client";

import { getUserDisplayName } from "@/lib/workspace";
import { motion } from "framer-motion";

export function CockpitHero({ preparedCount = 0 }: { preparedCount?: number }) {
  const name = getUserDisplayName();
  const firstName = name.split(" ")[0] || "there";
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
      className="space-y-1.5"
    >
      <p className="text-sm text-muted-foreground">
        {greeting}, {firstName} 👋
      </p>
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight leading-[1.15]">
        Your business is in flow.
        <br />
        <span className="text-[hsl(var(--kf-accent2))]">
          Let&apos;s keep the momentum.
        </span>
      </h1>
      {preparedCount > 0 && (
        <p className="text-sm text-muted-foreground pt-1">
          KEY has prepared{" "}
          <span className="font-semibold text-foreground">
            {preparedCount} action{preparedCount !== 1 ? "s" : ""}
          </span>{" "}
          that can move things forward today.
        </p>
      )}
    </motion.div>
  );
}
