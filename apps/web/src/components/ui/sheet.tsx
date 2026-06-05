"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";

interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function Sheet({ open, onOpenChange, children }: SheetProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      <div className="relative h-full w-full max-w-md bg-background shadow-2xl animate-in slide-in-from-right duration-300">
        {children}
      </div>
    </div>
  );
}

interface SheetContentProps {
  children: React.ReactNode;
  className?: string;
}

export function SheetContent({ children, className }: SheetContentProps) {
  return (
    <div className={cn("flex h-full flex-col overflow-y-auto p-6", className)}>
      {children}
    </div>
  );
}

interface SheetHeaderProps {
  children: React.ReactNode;
}

export function SheetHeader({ children }: SheetHeaderProps) {
  return <div className="mb-4">{children}</div>;
}

interface SheetTitleProps {
  children?: React.ReactNode;
  className?: string;
}

export function SheetTitle({ children, className }: SheetTitleProps) {
  return <h2 className={`text-lg font-semibold ${className ?? ""}`}>{children}</h2>;
}
