"use client";

import { motion } from "framer-motion";

export default function TestMotionPage() {
  return (
    <div style={{ padding: 40, background: "#111", color: "#fff" }}>
      <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        Auth Test with Motion
      </motion.h1>
      <p>If you can see this, framer-motion works.</p>
    </div>
  );
}
