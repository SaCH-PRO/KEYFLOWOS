"use client";

import { motion } from "framer-motion";
import { identityLogin } from "@/lib/client";

export default function TestClientPage() {
  return (
    <div style={{ padding: 40, background: "#111", color: "#fff" }}>
      <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        Auth Test with Client Lib
      </motion.h1>
      <p>If you can see this, @/lib/client import works.</p>
      <p>identityLogin type: {typeof identityLogin}</p>
    </div>
  );
}
