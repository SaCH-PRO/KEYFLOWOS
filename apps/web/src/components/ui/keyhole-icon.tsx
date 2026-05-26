"use client";

import { cn } from "@/lib/utils";

export function KeyholeIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      className={cn("w-4 h-4", className)}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Keyhole outer circle */}
      <circle
        cx="8"
        cy="8"
        r="6"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      {/* Keyhole slot */}
      <path
        d="M8 5.5a1.5 1.5 0 100 3 1.5 1.5 0 000-3z"
        fill="currentColor"
      />
      <path
        d="M7 8.5h2l-0.5 3h-1z"
        fill="currentColor"
      />
      {/* Glow dots */}
      <circle cx="8" cy="2" r="0.8" fill="currentColor" opacity="0.4" />
      <circle cx="8" cy="14" r="0.8" fill="currentColor" opacity="0.4" />
      <circle cx="2" cy="8" r="0.8" fill="currentColor" opacity="0.4" />
      <circle cx="14" cy="8" r="0.8" fill="currentColor" opacity="0.4" />
    </svg>
  );
}
