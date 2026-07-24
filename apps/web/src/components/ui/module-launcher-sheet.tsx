"use client";

import { useEffect } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type LauncherTone =
  | "default"
  | "primary"
  | "violet"
  | "gold"
  | "rose"
  | "mint"
  | "sky"
  | "orange"
  | "teal";

export interface ModuleLauncherItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ElementType;
  href?: string;
  onClick?: () => void;
  tone?: LauncherTone;
  badge?: string | number;
  disabled?: boolean;
}

export interface ModuleLauncherSection {
  id: string;
  label: string;
  items: ModuleLauncherItem[];
}

interface ModuleLauncherSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  sections: ModuleLauncherSection[];
}

const TONE_STYLES: Record<
  LauncherTone,
  { bg: string; icon: string; glow: string; gradient: string }
> = {
  default: {
    bg: "bg-muted/50",
    icon: "text-muted-foreground",
    glow: "shadow-none",
    gradient: "linear-gradient(135deg, hsl(var(--kf-muted-foreground) / 0.15), hsl(var(--kf-muted-foreground) / 0.05))",
  },
  primary: {
    bg: "bg-primary/10",
    icon: "text-primary",
    glow: "shadow-[0_0_16px_hsl(var(--kf-primary)/0.25)]",
    gradient: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.25), hsl(var(--kf-accent2) / 0.1))",
  },
  violet: {
    bg: "bg-violet/10",
    icon: "text-violet",
    glow: "shadow-[0_0_16px_hsl(var(--kf-violet)/0.25)]",
    gradient: "linear-gradient(135deg, hsl(var(--kf-violet) / 0.25), hsl(var(--kf-violet) / 0.05))",
  },
  gold: {
    bg: "bg-gold/10",
    icon: "text-gold",
    glow: "shadow-[0_0_16px_hsl(var(--kf-gold)/0.25)]",
    gradient: "linear-gradient(135deg, hsl(var(--kf-gold) / 0.25), hsl(var(--kf-gold) / 0.05))",
  },
  rose: {
    bg: "bg-rose/10",
    icon: "text-rose",
    glow: "shadow-[0_0_16px_hsl(var(--kf-rose)/0.25)]",
    gradient: "linear-gradient(135deg, hsl(var(--kf-rose) / 0.25), hsl(var(--kf-rose) / 0.05))",
  },
  mint: {
    bg: "bg-mint/10",
    icon: "text-mint",
    glow: "shadow-[0_0_16px_hsl(var(--kf-mint)/0.25)]",
    gradient: "linear-gradient(135deg, hsl(var(--kf-mint) / 0.25), hsl(var(--kf-mint) / 0.05))",
  },
  sky: {
    bg: "bg-sky/10",
    icon: "text-sky",
    glow: "shadow-[0_0_16px_hsl(var(--kf-sky)/0.25)]",
    gradient: "linear-gradient(135deg, hsl(var(--kf-sky) / 0.25), hsl(var(--kf-sky) / 0.05))",
  },
  orange: {
    bg: "bg-primary/10",
    icon: "text-primary",
    glow: "shadow-[0_0_16px_hsl(var(--kf-primary)/0.25)]",
    gradient: "linear-gradient(135deg, hsl(var(--kf-accent1) / 0.3), hsl(var(--kf-accent1) / 0.08))",
  },
  teal: {
    bg: "bg-secondary/10",
    icon: "text-secondary",
    glow: "shadow-[0_0_16px_hsl(var(--kf-secondary)/0.25)]",
    gradient: "linear-gradient(135deg, hsl(var(--kf-accent2) / 0.3), hsl(var(--kf-accent2) / 0.08))",
  },
};

function LauncherTile({
  item,
  index,
  onClose,
}: {
  item: ModuleLauncherItem;
  index: number;
  onClose: () => void;
}) {
  const tone = item.tone ?? "default";
  const styles = TONE_STYLES[tone];
  const Icon = item.icon;

  const content = (
    <>
      <div
        className={cn(
          "w-11 h-11 rounded-xl flex items-center justify-center mb-2.5 transition-all duration-200",
          styles.bg,
          styles.glow
        )}
        style={{ background: styles.gradient }}
      >
        <Icon className={cn("w-5 h-5", styles.icon)} />
      </div>
      <span className="text-sm font-semibold text-foreground leading-tight">
        {item.label}
      </span>
      {item.description && (
        <span className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 leading-snug">
          {item.description}
        </span>
      )}
      {item.badge !== undefined && item.badge !== 0 && (
        <span className="absolute top-2 right-2 h-4 min-w-[16px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center text-white bg-gradient-to-r from-primary to-secondary">
          {typeof item.badge === "number" && item.badge > 9 ? "9+" : item.badge}
        </span>
      )}
    </>
  );

  const className = cn(
    "relative flex flex-col items-start p-3 rounded-2xl border text-left transition-all duration-200",
    "active:scale-[0.98] focus-ring",
    item.disabled
      ? "opacity-40 cursor-not-allowed border-border/40 bg-muted/20"
      : "border-border/60 bg-card/60 hover:bg-card hover:border-primary/20 hover:shadow-md"
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={{
        duration: 0.25,
        delay: index * 0.03,
        ease: [0.19, 1, 0.22, 1],
      }}
      className="contents"
    >
      {item.href && !item.disabled ? (
        <Link
          href={item.href}
          onClick={() => {
            item.onClick?.();
            onClose();
          }}
          className={className}
        >
          {content}
        </Link>
      ) : (
        <button
          type="button"
          disabled={item.disabled}
          onClick={() => {
            item.onClick?.();
            onClose();
          }}
          className={className}
        >
          {content}
        </button>
      )}
    </motion.div>
  );
}

function LauncherHeader({
  title,
  subtitle,
  onClose,
  showHandle = false,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  showHandle?: boolean;
}) {
  return (
    <>
      {showHandle && (
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div
            className="w-10 h-1.5 rounded-full"
            style={{ background: "hsl(var(--kf-muted-foreground) / 0.25)" }}
          />
        </div>
      )}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{
              background:
                "linear-gradient(135deg, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)))",
            }}
          >
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-base font-bold">{title}</h2>
            {subtitle && (
              <p className="text-[11px] text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          autoFocus
          className="w-9 h-9 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Close"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </>
  );
}

function LauncherContent({
  sections,
  onClose,
}: {
  sections: ModuleLauncherSection[];
  onClose: () => void;
}) {
  return (
    <div className="overflow-y-auto px-4 pb-safe">
      {sections.map((section, sectionIndex) => (
        <div key={section.id} className={cn("pb-4", sectionIndex > 0 && "pt-2")}>
          <div className="flex items-center gap-2 px-1 mb-2.5">
            <div className="w-2 h-2 rounded-full bg-gradient-to-br from-primary to-secondary" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/80">
              {section.label}
            </span>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-4 gap-2.5">
            {section.items.map((item, itemIndex) => (
              <LauncherTile
                key={item.id}
                item={item}
                index={sectionIndex * 6 + itemIndex}
                onClose={onClose}
              />
            ))}
          </div>
        </div>
      ))}

      {sections.length === 0 && (
        <div className="py-12 text-center text-sm text-muted-foreground">
          No modules available right now.
        </div>
      )}

      <div className="h-4" />
    </div>
  );
}

export function ModuleLauncherSheet({
  open,
  onClose,
  title,
  subtitle,
  sections,
}: ModuleLauncherSheetProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const visibleSections = sections.filter((s) => s.items.length > 0);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Mobile bottom sheet */}
          <div
            className="fixed inset-0 z-[60] flex items-end md:hidden"
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={onClose}
            />
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 32, stiffness: 300 }}
              className="relative w-full rounded-t-3xl border-t flex flex-col shadow-2xl"
              style={{
                maxHeight: "85vh",
                background: "hsl(var(--kf-card))",
                borderColor: "hsl(var(--kf-border))",
              }}
            >
              <div
                className="absolute top-0 left-0 right-0 h-[2px] opacity-60"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)), transparent)",
                }}
              />
              <LauncherHeader title={title} subtitle={subtitle} onClose={onClose} showHandle />
              <LauncherContent sections={visibleSections} onClose={onClose} />
            </motion.div>
          </div>

          {/* Desktop centered dialog */}
          <div
            className="fixed inset-0 z-[60] hidden md:flex items-center justify-center p-4"
            role="dialog"
            aria-modal="true"
            aria-label={title}
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={onClose}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, y: 8 }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
              className="relative w-full max-w-2xl max-h-[80vh] rounded-2xl border flex flex-col shadow-2xl overflow-hidden"
              style={{
                background: "hsl(var(--kf-card))",
                borderColor: "hsl(var(--kf-border))",
              }}
            >
              <div
                className="absolute top-0 left-0 right-0 h-[2px] opacity-60"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, hsl(var(--kf-accent1)), hsl(var(--kf-accent2)), transparent)",
                }}
              />
              <LauncherHeader title={title} subtitle={subtitle} onClose={onClose} />
              <LauncherContent sections={visibleSections} onClose={onClose} />
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
