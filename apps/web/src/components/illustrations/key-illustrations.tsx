"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/* ─── Animated Flow Lines ─── */
export function FlowLines({ className }: { className?: string }) {
  return (
    <svg
      className={cn("absolute inset-0 w-full h-full pointer-events-none opacity-30", className)}
      viewBox="0 0 400 200"
      preserveAspectRatio="none"
    >
      <motion.path
        d="M0 100 Q100 50, 200 100 Q300 150, 400 100"
        stroke="url(#flowGrad)"
        strokeWidth="1"
        fill="none"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 2, ease: "easeInOut" }}
      />
      <motion.path
        d="M0 120 Q100 70, 200 120 Q300 170, 400 120"
        stroke="url(#flowGrad2)"
        strokeWidth="0.5"
        fill="none"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 0.5 }}
        transition={{ duration: 2.5, ease: "easeInOut", delay: 0.3 }}
      />
      <defs>
        <linearGradient id="flowGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="hsl(var(--kf-accent1))" stopOpacity="0" />
          <stop offset="50%" stopColor="hsl(var(--kf-accent1))" stopOpacity="0.6" />
          <stop offset="100%" stopColor="hsl(var(--kf-accent2))" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="flowGrad2" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="hsl(var(--kf-accent2))" stopOpacity="0" />
          <stop offset="50%" stopColor="hsl(var(--kf-accent2))" stopOpacity="0.4" />
          <stop offset="100%" stopColor="hsl(var(--kf-accent1))" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

/* ─── Gradient Orb Decoration ─── */
export function GradientOrb({
  className,
  size = 200,
  color = "mixed",
}: {
  className?: string;
  size?: number;
  color?: "orange" | "teal" | "mixed" | "violet";
}) {
  const colors = {
    orange: "from-orange-500/20 to-orange-600/5",
    teal: "from-teal-500/20 to-teal-600/5",
    mixed: "from-orange-500/15 via-teal-500/10 to-violet-500/5",
    violet: "from-violet-500/20 to-violet-600/5",
  };

  return (
    <div
      className={cn(
        "rounded-full bg-gradient-to-br blur-3xl pointer-events-none animate-mesh-shift",
        colors[color],
        className
      )}
      style={{ width: size, height: size }}
    />
  );
}

/* ─── Circuit Pattern Background ─── */
export function CircuitPattern({ className }: { className?: string }) {
  return (
    <svg
      className={cn("absolute inset-0 w-full h-full pointer-events-none opacity-[0.03]", className)}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
    >
      <pattern id="circuit" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
        <circle cx="10" cy="10" r="1" fill="currentColor" />
        <path d="M10 0 L10 9 M10 11 L10 20 M0 10 L9 10 M11 10 L20 10" stroke="currentColor" strokeWidth="0.5" />
      </pattern>
      <rect width="100" height="100" fill="url(#circuit)" />
    </svg>
  );
}

/* ─── Empty State: CRM / Contacts ─── */
export function EmptyStateCRM({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 160"
      className={cn("w-full max-w-[200px] mx-auto", className)}
      fill="none"
    >
      <motion.g
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        {/* Contact book */}
        <rect x="60" y="40" width="80" height="90" rx="8" fill="hsl(var(--kf-card))" stroke="hsl(var(--kf-border))" strokeWidth="1.5" />
        <rect x="55" y="45" width="80" height="90" rx="8" fill="hsl(var(--kf-card))" stroke="hsl(var(--kf-border))" strokeWidth="1.5" />
        
        {/* Contact lines */}
        <circle cx="85" cy="70" r="12" fill="hsl(var(--kf-muted))" />
        <rect x="105" y="62" width="20" height="4" rx="2" fill="hsl(var(--kf-muted))" />
        <rect x="105" y="70" width="15" height="3" rx="1.5" fill="hsl(var(--kf-muted))" opacity="0.6" />
        
        <circle cx="85" cy="105" r="12" fill="hsl(var(--kf-muted))" opacity="0.5" />
        <rect x="105" y="97" width="20" height="4" rx="2" fill="hsl(var(--kf-muted))" opacity="0.5" />
        
        {/* Key unlocking */}
        <motion.g
          animate={{ rotate: [0, -15, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          style={{ originX: "150px", originY: "85px" }}
        >
          <circle cx="150" cy="70" r="14" stroke="url(#keyGrad)" strokeWidth="2" fill="none" />
          <circle cx="150" cy="70" r="4" fill="url(#keyGrad)" />
          <path d="M162 70 L185 70 L185 75 L175 75 L175 80 L182 80 L182 85 L175 85 L175 90 L185 90 L185 95 L162 95 Z" fill="url(#keyGrad)" opacity="0.8" />
        </motion.g>
        
        {/* Glow effect */}
        <circle cx="150" cy="70" r="20" fill="url(#glowGrad)" opacity="0.3" />
        
        <defs>
          <linearGradient id="keyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F97316" />
            <stop offset="100%" stopColor="#14B8A6" />
          </linearGradient>
          <radialGradient id="glowGrad">
            <stop offset="0%" stopColor="#F97316" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#14B8A6" stopOpacity="0" />
          </radialGradient>
        </defs>
      </motion.g>
    </svg>
  );
}

/* ─── Empty State: Revenue ─── */
export function EmptyStateRevenue({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 160"
      className={cn("w-full max-w-[200px] mx-auto", className)}
      fill="none"
    >
      <motion.g
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        {/* Vault */}
        <rect x="50" y="30" width="100" height="100" rx="12" fill="hsl(var(--kf-card))" stroke="hsl(var(--kf-border))" strokeWidth="1.5" />
        <circle cx="100" cy="80" r="25" fill="none" stroke="hsl(var(--kf-border))" strokeWidth="2" />
        <circle cx="100" cy="80" r="8" fill="hsl(var(--kf-muted))" />
        <rect x="98" y="80" width="4" height="20" rx="2" fill="hsl(var(--kf-muted))" />
        
        {/* Key turning */}
        <motion.g
          animate={{ rotate: [0, 90, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
          style={{ originX: "100px", originY: "80px" }}
        >
          <circle cx="140" cy="60" r="12" stroke="url(#keyGrad2)" strokeWidth="2" fill="none" />
          <circle cx="140" cy="60" r="3" fill="url(#keyGrad2)" />
          <path d="M150 60 L170 60 L170 63 L165 63 L165 66 L168 66 L168 69 L165 69 L165 72 L170 72 L170 75 L150 75 Z" fill="url(#keyGrad2)" opacity="0.8" />
        </motion.g>
        
        {/* Coins flowing out */}
        {[0, 1, 2].map((i) => (
          <motion.circle
            key={i}
            cx={160 + i * 12}
            cy={110}
            r={6}
            fill="url(#keyGrad2)"
            opacity={0.6 - i * 0.15}
            animate={{ y: [0, -5, 0], opacity: [0.6 - i * 0.15, 0.8 - i * 0.15, 0.6 - i * 0.15] }}
            transition={{ duration: 2, repeat: Infinity, delay: i * 0.4 }}
          />
        ))}
        
        <defs>
          <linearGradient id="keyGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F97316" />
            <stop offset="100%" stopColor="#14B8A6" />
          </linearGradient>
        </defs>
      </motion.g>
    </svg>
  );
}

/* ─── Empty State: Bookings ─── */
export function EmptyStateBookings({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 160"
      className={cn("w-full max-w-[200px] mx-auto", className)}
      fill="none"
    >
      <motion.g
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        {/* Calendar door */}
        <rect x="55" y="25" width="90" height="110" rx="10" fill="hsl(var(--kf-card))" stroke="hsl(var(--kf-border))" strokeWidth="1.5" />
        
        {/* Calendar grid */}
        {[0, 1, 2, 3].map((row) =>
          [0, 1, 2].map((col) => (
            <rect
              key={`${row}-${col}`}
              x={65 + col * 24}
              y={50 + row * 20}
              width={18}
              height={14}
              rx={3}
              fill="hsl(var(--kf-muted))"
              opacity={0.4}
            />
          ))
        )}
        
        {/* Key opening the door */}
        <motion.g
          animate={{ x: [0, 5, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        >
          <circle cx="145" cy="80" r="14" stroke="url(#keyGrad3)" strokeWidth="2" fill="none" />
          <circle cx="145" cy="80" r="4" fill="url(#keyGrad3)" />
          <path d="M157 80 L180 80 L180 84 L172 84 L172 88 L177 88 L177 92 L172 92 L172 96 L180 96 L180 100 L157 100 Z" fill="url(#keyGrad3)" opacity="0.8" />
        </motion.g>
        
        {/* Door opening crack */}
        <motion.line
          x1="145"
          y1="25"
          x2="145"
          y2="135"
          stroke="url(#keyGrad3)"
          strokeWidth="1"
          opacity="0.3"
          animate={{ opacity: [0.1, 0.4, 0.1] }}
          transition={{ duration: 3, repeat: Infinity }}
        />
        
        <defs>
          <linearGradient id="keyGrad3" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F97316" />
            <stop offset="100%" stopColor="#14B8A6" />
          </linearGradient>
        </defs>
      </motion.g>
    </svg>
  );
}

/* ─── Empty State: Projects ─── */
export function EmptyStateProjects({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 160"
      className={cn("w-full max-w-[200px] mx-auto", className)}
      fill="none"
    >
      <motion.g
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        {/* Puzzle pieces */}
        <motion.path
          d="M60 50 h25 v10 h5 v-10 h25 v25 h-10 v5 h10 v25 h-25 v-10 h-5 v10 h-25 v-25 h10 v-5 h-10 z"
          fill="hsl(var(--kf-card))"
          stroke="hsl(var(--kf-border))"
          strokeWidth="1.5"
          animate={{ x: [0, 2, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.path
          d="M100 90 h20 v8 h5 v-8 h20 v20 h-8 v5 h8 v20 h-20 v-8 h-5 v8 h-20 v-20 h8 v-5 h-8 z"
          fill="hsl(var(--kf-card))"
          stroke="url(#keyGrad4)"
          strokeWidth="1.5"
          opacity="0.8"
          animate={{ x: [0, -2, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "easeInOut", delay: 0.5 }}
        />
        
        {/* Key fitting into puzzle */}
        <motion.g
          animate={{ y: [0, -3, 0], rotate: [0, 5, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
        >
          <circle cx="150" cy="60" r="12" stroke="url(#keyGrad4)" strokeWidth="2" fill="none" />
          <circle cx="150" cy="60" r="3" fill="url(#keyGrad4)" />
          <path d="M160 60 L180 60 L180 63 L175 63 L175 66 L178 66 L178 69 L175 69 L175 72 L180 72 L180 75 L160 75 Z" fill="url(#keyGrad4)" opacity="0.8" />
        </motion.g>
        
        <defs>
          <linearGradient id="keyGrad4" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F97316" />
            <stop offset="100%" stopColor="#14B8A6" />
          </linearGradient>
        </defs>
      </motion.g>
    </svg>
  );
}

/* ─── SparkLine Mini Chart ─── */
export function SparkLine({
  data,
  className,
  color = "mixed",
}: {
  data: number[];
  className?: string;
  color?: "orange" | "teal" | "mixed";
}) {
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const width = 60;
  const height = 20;
  const points = data.map((v, i) => ({
    x: (i / (data.length - 1)) * width,
    y: height - ((v - min) / range) * height,
  }));
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const areaD = `${pathD} L ${width} ${height} L 0 ${height} Z`;

  const strokeColor =
    color === "orange"
      ? "hsl(var(--kf-accent1))"
      : color === "teal"
      ? "hsl(var(--kf-accent2))"
      : "url(#sparkGrad)";

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={cn("w-[60px] h-[20px]", className)}
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id="sparkGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="hsl(var(--kf-accent1))" />
          <stop offset="100%" stopColor="hsl(var(--kf-accent2))" />
        </linearGradient>
        <linearGradient id="sparkArea" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="hsl(var(--kf-accent1))" stopOpacity="0.2" />
          <stop offset="100%" stopColor="hsl(var(--kf-accent2))" stopOpacity="0" />
        </linearGradient>
      </defs>
      <motion.path
        d={areaD}
        fill="url(#sparkArea)"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
      />
      <motion.path
        d={pathD}
        stroke={strokeColor}
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1, ease: "easeOut" }}
      />
    </svg>
  );
}
