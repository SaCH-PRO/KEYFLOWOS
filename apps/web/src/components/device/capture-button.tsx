"use client";

import { useState } from "react";
import { Camera, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CaptureSheet } from "./capture-sheet";

interface CaptureButtonProps {
  businessId: string;
  variant?: "fab" | "inline" | "icon";
  className?: string;
}

export function CaptureButton({ businessId, variant = "fab", className }: CaptureButtonProps) {
  const [open, setOpen] = useState(false);

  if (variant === "icon") {
    return (
      <>
        <Button size="icon" variant="ghost" onClick={() => setOpen(true)} className={className}>
          <Camera className="h-5 w-5" />
        </Button>
        <CaptureSheet businessId={businessId} open={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  if (variant === "inline") {
    return (
      <>
        <Button onClick={() => setOpen(true)} className={className}>
          <Camera className="h-4 w-4 mr-2" />
          Capture
        </Button>
        <CaptureSheet businessId={businessId} open={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`
          fixed bottom-6 right-6 z-50
          h-14 w-14 rounded-full
          bg-primary text-primary-foreground
          shadow-lg hover:shadow-xl
          flex items-center justify-center
          transition-transform hover:scale-105 active:scale-95
          ${className ?? ""}
        `}
        aria-label="Capture"
      >
        <Plus className="h-6 w-6" />
      </button>
      <CaptureSheet businessId={businessId} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
