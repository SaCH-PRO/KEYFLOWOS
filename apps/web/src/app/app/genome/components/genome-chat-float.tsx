"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { MessageSquare } from "lucide-react";
import { useGenome } from "@/contexts/genome-context";
import { GenomeChatPanel } from "../../profile/components/business-genome/genome-chat-panel";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface GenomeChatFloatProps {
  inline?: boolean;
}

export function GenomeChatFloat({ inline }: GenomeChatFloatProps) {
  const { genome, refresh } = useGenome();
  const [open, setOpen] = useState(false);

  if (!genome) return null;

  if (inline) {
    return (
      <div className="h-full flex flex-col">
        <GenomeChatPanel genome={genome} onGenomeUpdate={refresh} />
      </div>
    );
  }

  return (
    <>
      <motion.button
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        onClick={() => setOpen(true)}
        className="fixed bottom-24 right-4 md:bottom-8 md:right-8 z-40 w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center"
        aria-label="Open Genome Chat"
      >
        <MessageSquare className="w-5 h-5" />
      </motion.button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-md p-0 flex flex-col">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 p-4 border-b">
              <MessageSquare className="w-4 h-4" />
              Genome Chat
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 overflow-hidden">
            <GenomeChatPanel genome={genome} onGenomeUpdate={refresh} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
