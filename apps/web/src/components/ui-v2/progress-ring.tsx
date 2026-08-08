import * as React from "react";
import { cn } from "@/lib/utils";

export interface ProgressRingProps extends React.SVGAttributes<SVGSVGElement> {
  value: number;
  size?: number;
  thickness?: number;
  segments?: number;
  color?: "orange" | "teal" | "violet" | "gold" | "rose";
  children?: React.ReactNode;
}

export function ProgressRing({
  value,
  size = 80,
  thickness = 8,
  segments = 0,
  color = "orange",
  className,
  children,
  ...props
}: ProgressRingProps) {
  const stroke = thickness;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(100, Math.max(0, value));
  const offset = circumference - (progress / 100) * circumference;

  const colorClass =
    color === "orange"
      ? "text-primary"
      : color === "teal"
        ? "text-secondary"
        : color === "violet"
          ? "text-violet"
          : color === "rose"
            ? "text-rose"
            : "text-gold";

  if (segments > 0) {
    const gap = 4;
    const segmentLength = circumference / segments - (gap * size) / 100;

    return (
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className={cn("-rotate-90", colorClass, className)}
        {...props}
      >
        {Array.from({ length: segments }).map((_, i) => {
          const filled = i / segments < progress / 100;
          return (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke="currentColor"
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${segmentLength} ${circumference - segmentLength}`}
              strokeDashoffset={-i * (circumference / segments)}
              className={cn(
                "transition-all duration-base ease-flow",
                filled ? "opacity-100" : "opacity-20",
              )}
            />
          );
        })}
        {children && (
          <foreignObject x="0" y="0" width={size} height={size}>
            <div className="flex h-full w-full items-center justify-center">{children}</div>
          </foreignObject>
        )}
      </svg>
    );
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn("-rotate-90", className)}
      {...props}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        className="text-muted opacity-30"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className={cn("transition-all duration-base ease-flow", colorClass)}
      />
      {children && (
        <foreignObject x="0" y="0" width={size} height={size}>
          <div className="flex h-full w-full items-center justify-center">{children}</div>
        </foreignObject>
      )}
    </svg>
  );
}
