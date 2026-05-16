"use client";

import { motion } from "framer-motion";
import {
  Calendar,
  DollarSign,
  Users,
  ShieldCheck,
} from "lucide-react";

const NODES = [
  { icon: Calendar, label: "Today", x: 12, color: "hsl(var(--kf-accent2))" },
  { icon: DollarSign, label: "Revenue", x: 28, color: "hsl(var(--kf-warning))" },
  { icon: Users, label: "Clients", x: 72, color: "hsl(var(--kf-info))" },
  { icon: ShieldCheck, label: "Approvals", x: 88, color: "hsl(var(--kf-accent1))" },
];

export function CockpitFlowVisual() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, delay: 0.3 }}
      className="relative h-16 w-full overflow-hidden select-none"
    >
      <svg
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="none"
        viewBox="0 0 1000 120"
      >
        {/* Background track */}
        <path
          d="M 80 60 Q 250 10, 500 60 Q 750 110, 920 60"
          fill="none"
          stroke="hsl(var(--kf-border))"
          strokeWidth="2"
          strokeDasharray="8 6"
          opacity="0.5"
        />
        {/* Animated flow line */}
        <motion.path
          d="M 80 60 Q 250 10, 500 60 Q 750 110, 920 60"
          fill="none"
          stroke="url(#flowGradient)"
          strokeWidth="3"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 2, ease: "easeInOut", delay: 0.5 }}
        />
        <defs>
          <linearGradient id="flowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(var(--kf-accent2))" />
            <stop offset="50%" stopColor="hsl(var(--kf-accent1))" />
            <stop offset="100%" stopColor="hsl(var(--kf-info))" />
          </linearGradient>
        </defs>
      </svg>

      {/* Center K node */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.8 }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 rounded-full bg-gradient-to-br from-[hsl(var(--kf-accent1))] to-[hsl(var(--kf-accent2))] flex items-center justify-center shadow-lg z-10"
        style={{ boxShadow: "0 4px 20px hsl(var(--kf-accent1) / 0.3)" }}
      >
        <span className="text-white font-bold text-sm">K</span>
      </motion.div>

      {/* Side nodes */}
      {NODES.map((node, i) => (
        <motion.div
          key={node.label}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{
            type: "spring",
            stiffness: 200,
            damping: 15,
            delay: 1 + i * 0.1,
          }}
          className="absolute top-1/2 -translate-y-1/2 flex flex-col items-center gap-1"
          style={{ left: `${node.x}%`, transform: "translate(-50%, -50%)" }}
        >
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center border-2 bg-[hsl(var(--kf-card))]"
            style={{ borderColor: `${node.color}40` }}
          >
            <node.icon className="w-3.5 h-3.5" style={{ color: node.color }} />
          </div>
          <span
            className="text-[9px] font-medium uppercase tracking-wider"
            style={{ color: node.color }}
          >
            {node.label}
          </span>
        </motion.div>
      ))}
    </motion.div>
  );
}
