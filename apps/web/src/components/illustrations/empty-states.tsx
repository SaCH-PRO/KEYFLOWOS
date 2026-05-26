"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import {
  EmptyStateCRM,
  EmptyStateRevenue,
  EmptyStateBookings,
  EmptyStateProjects,
} from "./key-illustrations";

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

function EmptyStateContainer({
  illustration,
  title,
  description,
  action,
  className,
}: EmptyStateProps & { illustration: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className={cn(
        "flex flex-col items-center justify-center py-12 px-6 text-center",
        className
      )}
    >
      <div className="relative mb-6">
        {illustration}
        {/* Subtle glow behind illustration */}
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-orange-500/5 to-teal-500/5 blur-2xl rounded-full" />
      </div>
      <h3 className="text-sm font-semibold text-foreground mb-1">{title}</h3>
      {description && (
        <p className="text-xs text-muted-foreground max-w-[280px] mb-4">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </motion.div>
  );
}

export function EmptyStateContacts(props: Omit<EmptyStateProps, "title">) {
  return (
    <EmptyStateContainer
      illustration={<EmptyStateCRM />}
      title="No contacts yet"
      description="Add your first contact and let KEY help you nurture those relationships."
      {...props}
    />
  );
}

export function EmptyStateInvoices(props: Omit<EmptyStateProps, "title">) {
  return (
    <EmptyStateContainer
      illustration={<EmptyStateRevenue />}
      title="No invoices yet"
      description="Create your first invoice and watch KEY track your revenue flow."
      {...props}
    />
  );
}

export function EmptyStateBookingsModule(props: Omit<EmptyStateProps, "title">) {
  return (
    <EmptyStateContainer
      illustration={<EmptyStateBookings />}
      title="No bookings yet"
      description="Set up your services and let KEY fill your calendar."
      {...props}
    />
  );
}

export function EmptyStateProjectsModule(props: Omit<EmptyStateProps, "title">) {
  return (
    <EmptyStateContainer
      illustration={<EmptyStateProjects />}
      title="No projects yet"
      description="Create your first project and let KEY keep everything on track."
      {...props}
    />
  );
}

export function EmptyStateGeneric({
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <EmptyStateContainer
      illustration={
        <svg viewBox="0 0 200 160" className="w-full max-w-[200px] mx-auto" fill="none">
          <motion.g
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
          >
            <circle cx="100" cy="80" r="40" fill="hsl(var(--kf-muted))" opacity="0.3" />
            <motion.circle
              cx="100"
              cy="80"
              r="30"
              stroke="url(#genericGrad)"
              strokeWidth="2"
              fill="none"
              animate={{ r: [30, 35, 30] }}
              transition={{ duration: 3, repeat: Infinity }}
            />
            <circle cx="100" cy="80" r="8" fill="url(#genericGrad)" />
            <motion.path
              d="M120 80 L155 80 L155 84 L148 84 L148 88 L152 88 L152 92 L148 92 L148 96 L155 96 L155 100 L120 100 Z"
              fill="url(#genericGrad)"
              opacity="0.8"
              animate={{ rotate: [0, 10, 0] }}
              transition={{ duration: 4, repeat: Infinity }}
              style={{ originX: "100px", originY: "80px" }}
            />
            <defs>
              <linearGradient id="genericGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#F97316" />
                <stop offset="100%" stopColor="#14B8A6" />
              </linearGradient>
            </defs>
          </motion.g>
        </svg>
      }
      title={title}
      description={description}
      action={action}
      className={className}
    />
  );
}
