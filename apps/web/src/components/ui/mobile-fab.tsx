"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, Calendar, FileText, Users, X } from "lucide-react";
import { useRouter, usePathname } from "next/navigation";

const FAB_ACTIONS = [
  { key: "booking", label: "New Booking", icon: Calendar, href: "/app/bookings?action=new" },
  { key: "invoice", label: "New Invoice", icon: FileText, href: "/app/commerce?tab=invoices&action=new" },
  { key: "contact", label: "New Contact", icon: Users, href: "/app/network/contacts?action=new" },
];

export function MobileFab() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  // Don't show FAB on auth pages or public pages
  if (!pathname?.startsWith("/app/")) return null;

  return (
    <div className="md:hidden fixed bottom-[72px] right-4 z-[55]">
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/30 backdrop-blur-sm"
              style={{ bottom: "56px" }}
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.9 }}
              transition={{ type: "spring", bounce: 0.2, duration: 0.35 }}
              className="absolute bottom-14 right-0 flex flex-col items-end gap-2"
            >
              {FAB_ACTIONS.map((action, i) => (
                <motion.button
                  key={action.key}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 20 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => {
                    setOpen(false);
                    router.push(action.href);
                  }}
                  className="flex items-center gap-2.5 pr-3"
                >
                  <span className="text-sm font-medium text-white drop-shadow-md">
                    {action.label}
                  </span>
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center shadow-lg"
                    style={{ background: "hsl(var(--kf-card))", border: "1px solid hsl(var(--border))" }}
                  >
                    <action.icon className="w-4 h-4" style={{ color: "hsl(var(--kf-accent1))" }} />
                  </div>
                </motion.button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <motion.button
        onClick={() => setOpen(!open)}
        className="w-12 h-12 rounded-full flex items-center justify-center shadow-lg"
        style={{ background: "hsl(var(--kf-accent1))" }}
        whileTap={{ scale: 0.9 }}
        aria-label={open ? "Close quick actions" : "Quick create"}
      >
        <motion.div
          animate={{ rotate: open ? 45 : 0 }}
          transition={{ duration: 0.2 }}
        >
          <Plus className="w-5 h-5 text-white" />
        </motion.div>
      </motion.button>
    </div>
  );
}
