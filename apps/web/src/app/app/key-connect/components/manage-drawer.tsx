"use client";

import { X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface ManageDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function ManageDrawer({ open, onClose, title, children }: ManageDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent>
        <SheetHeader>
          <div className="flex items-center justify-between gap-3">
            <SheetTitle>{title}</SheetTitle>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto -mx-6 px-6 pb-6">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
