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

/* ─── Animated particle traveling along the flow path ─── */
function FlowParticle({ delay }: { delay: number }) {
  return (
    <motion.circle
      r="3"
      fill="url(#particleGrad)"
      filter="url(#particleGlow)"
      initial={{ offsetDistance: "0%" }}
      animate={{ offsetDistance: "100%" }}
      transition={{
        duration: 4,
        repeat: Infinity,
        ease: "linear",
        delay,
      }}
      style={{
        offsetPath: "path('M 80 60 Q 250 10, 500 60 Q 750 110, 920 60')",
      }}
    />
  );
}

export function CockpitFlowVisual() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.8, delay: 0.3 }}
      className="relative h-20 w-full overflow-hidden select-none"
    >
      <svg
        className="absolute inset-0 w-full h-full"
        preserveAspectRatio="none"
        viewBox="0 0 1000 120"
      >
        <defs>
          <linearGradient id="flowGradient" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(var(--kf-accent2))" />
            <stop offset="50%" stopColor="hsl(var(--kf-accent1))" />
            <stop offset="100%" stopColor="hsl(var(--kf-info))" />
          </linearGradient>
          <linearGradient id="particleGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="hsl(var(--kf-accent2))" />
            <stop offset="100%" stopColor="hsl(var(--kf-accent1))" />
          </linearGradient>
          <filter id="particleGlow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Background track */}
        <path
          d="M 80 60 Q 250 10, 500 60 Q 750 110, 920 60"
          fill="none"
          stroke="hsl(var(--kf-border))"
          strokeWidth="2"
          strokeDasharray="8 6"
          opacity="0.4"
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

        {/* Flow particles */}
        <FlowParticle delay={0} />
        <FlowParticle delay={1.3} />
        <FlowParticle delay={2.6} />
      </svg>

      {/* Center K node — larger, more prominent */}
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 200, damping: 15, delay: 0.8 }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10"
      >
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center relative"
          style={{
            background: "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
            boxShadow: "0 4px 24px hsl(var(--kf-accent1) / 0.35), 0 0 0 4px hsl(var(--kf-card)), 0 0 0 5px hsl(var(--kf-border))",
          }}
        >
          <span className="text-white font-bold text-lg">K</span>
          {/* Orbital ring */}
          <div className="absolute inset-[-8px] rounded-full border border-dashed border-orange-400/20 animate-orbit" />
        </div>
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
          <motion.div
            whileHover={{ scale: 1.15 }}
            className="w-9 h-9 rounded-full flex items-center justify-center border-2 bg-[hsl(var(--kf-card))] cursor-pointer transition-shadow hover:shadow-lg"
            style={{ borderColor: `${node.color}40` }}
          >
            <node.icon className="w-4 h-4" style={{ color: node.color }} />
          </motion.div>
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
