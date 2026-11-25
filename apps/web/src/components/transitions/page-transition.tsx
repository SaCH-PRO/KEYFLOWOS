"use client";

import { motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";

interface PageTransitionProps {
  children: ReactNode;
}

/**
 * The page's entrance in the app shell: each page fades in, keyed by its pathname.
 *
 * FU-REQUIRE-AUTH-REMOUNT: no exit animation (no AnimatePresence). Under <AnimatePresence mode="wait"> the leaving
 * wrapper stayed mounted for its exit, and `children` (Next's layout router, which renders the CURRENT route from
 * context) rendered the destination page inside it: the destination page mounted twice, and a page that reads and
 * strips a one-shot URL parameter on mount (/app/bookings?contactId=) lost it to the first instance. Keyed by the
 * pathname alone, the leaving page unmounts at once and the destination page mounts once.
 */
export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname();

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 12, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{
        duration: 0.25,
        ease: [0.25, 0.46, 0.45, 0.94],
      }}
      className="h-full"
    >
      {children}
    </motion.div>
  );
}
