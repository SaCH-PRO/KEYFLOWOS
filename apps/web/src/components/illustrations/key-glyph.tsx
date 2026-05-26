"use client";

import { cn } from "@/lib/utils";

interface KeyGlyphProps {
  className?: string;
  size?: number;
  animate?: boolean;
  variant?: "default" | "glow" | "processing" | "success";
}

export function KeyGlyph({
  className,
  size = 24,
  animate = false,
  variant = "default",
}: KeyGlyphProps) {
  const glowFilter = variant === "glow" || variant === "processing";
  const isProcessing = variant === "processing";
  const isSuccess = variant === "success";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(
        animate && isProcessing && "animate-key-glow-pulse",
        className
      )}
    >
      {glowFilter && (
        <defs>
          <filter id="keyGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="keyGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F97316" />
            <stop offset="100%" stopColor="#14B8A6" />
          </linearGradient>
          <linearGradient id="keyGradientSuccess" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22c55e" />
            <stop offset="100%" stopColor="#14B8A6" />
          </linearGradient>
        </defs>
      )}

      {/* Key bow (the round top) */}
      <circle
        cx="14"
        cy="14"
        r="10"
        stroke={isSuccess ? "url(#keyGradientSuccess)" : "url(#keyGradient)"}
        strokeWidth="2.5"
        fill="none"
        filter={glowFilter ? "url(#keyGlow)" : undefined}
        className={animate && isProcessing ? "animate-slow-pulse" : ""}
      />

      {/* Keyhole */}
      <circle
        cx="14"
        cy="14"
        r="3"
        fill={isSuccess ? "#22c55e" : "#F97316"}
        className={animate ? "animate-slow-pulse" : ""}
      />

      {/* Key blade */}
      <path
        d="M22 14 L36 14 L36 17 L30 17 L30 20 L34 20 L34 23 L30 23 L30 26 L36 26 L36 29 L22 29 Z"
        fill={isSuccess ? "url(#keyGradientSuccess)" : "url(#keyGradient)"}
        filter={glowFilter ? "url(#keyGlow)" : undefined}
        opacity="0.9"
      />

      {/* Flow lines on blade */}
      <line x1="24" y1="16" x2="32" y2="16" stroke="white" strokeWidth="0.8" opacity="0.5" />
      <line x1="24" y1="21.5" x2="32" y2="21.5" stroke="white" strokeWidth="0.8" opacity="0.5" />
      <line x1="24" y1="27" x2="32" y2="27" stroke="white" strokeWidth="0.8" opacity="0.5" />
    </svg>
  );
}

export function KeyOrb({
  size = 40,
  className,
  state = "idle",
}: {
  size?: number;
  className?: string;
  state?: "idle" | "active" | "processing" | "suggestion";
}) {
  const stateStyles = {
    idle: "from-teal-500/20 to-orange-500/10 shadow-[0_0_20px_hsl(var(--kf-accent2)/0.15)]",
    active: "from-orange-500/30 to-teal-500/20 shadow-[0_0_30px_hsl(var(--kf-accent1)/0.25)]",
    processing: "from-orange-500/25 to-violet-500/20 shadow-[0_0_40px_hsl(var(--kf-accent1)/0.3)] animate-key-glow-pulse",
    suggestion: "from-orange-500/35 to-amber-500/25 shadow-[0_0_35px_hsl(var(--kf-accent1)/0.35)] animate-slow-pulse",
  };

  return (
    <div
      className={cn(
        "relative rounded-full flex items-center justify-center",
        "bg-gradient-to-br",
        stateStyles[state],
        className
      )}
      style={{ width: size, height: size }}
    >
      <KeyGlyph size={size * 0.55} variant={state === "processing" ? "processing" : "glow"} />
      
      {/* Orbital ring for processing state */}
      {state === "processing" && (
        <div className="absolute inset-0 rounded-full border-2 border-dashed border-orange-400/20 animate-orbit" />
      )}
    </div>
  );
}
