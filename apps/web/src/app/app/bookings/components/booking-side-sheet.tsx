"use client";

import { motion } from "framer-motion";
import { X, CalendarDays } from "lucide-react";
import type { Service, StaffMember, Contact } from "./bookings-types";
import BookingForm from "./booking-form";
import { useIsMobile } from "@/hooks/use-is-mobile";
import { useNavigationContext } from "@/lib/navigation-context";
import { TaskContinuityHeader } from "@/components/ui/task-continuity-header";
import { useRouter } from "next/navigation";

interface BookingSideSheetProps {
  open: boolean;
  services: Service[];
  staff: StaffMember[];
  contacts: Contact[];
  onSubmit: (data: {
    date: string;
    time: string;
    serviceId: string;
    staffId: string;
    contactId: string;
  }) => void;
  onClose: () => void;
  formError: string | null;
  defaultDate?: string;
  defaultTime?: string;
  defaultContactId?: string;
  saving?: boolean;
}

export default function BookingSideSheet({
  open,
  services,
  staff,
  contacts,
  onSubmit,
  onClose,
  formError,
  defaultDate,
  defaultTime,
  defaultContactId,
  saving,
}: BookingSideSheetProps) {
  const isMobile = useIsMobile();
  const router = useRouter();
  const { getOriginContext } = useNavigationContext();
  const originContext = getOriginContext();
  const crossModuleOrigin = originContext && originContext.workspace && originContext.workspace !== "Calendar"
    ? { label: originContext.workspace, route: originContext.route }
    : null;

  const handleReturnToOrigin = () => {
    onClose();
    if (crossModuleOrigin?.route) {
      router.push(crossModuleOrigin.route);
    }
  };

  if (!open) return null;

  const prefillContact = defaultContactId
    ? contacts.find((c) => c.id === defaultContactId)
    : undefined;
  const prefillContactName = prefillContact
    ? `${prefillContact.firstName ?? ""} ${prefillContact.lastName ?? ""}`.trim() || prefillContact.email || ""
    : undefined;
  const taskLabel = prefillContactName ? `New Booking · ${prefillContactName}` : "New Booking";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className={isMobile ? "fixed inset-0 z-50 flex items-end" : "fixed inset-0 z-50 flex items-start justify-end"}
    >
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {isMobile ? (
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative w-full rounded-t-2xl border-t overflow-y-auto"
          style={{
            maxHeight: "90vh",
            background: "hsl(var(--kf-card))",
            borderColor: "hsl(var(--kf-border))",
          }}
        >
          <div className="flex justify-center pt-2 pb-1 flex-shrink-0">
            <div
              className="w-10 h-1 rounded-full"
              style={{ background: "hsl(var(--kf-muted-foreground) / 0.3)" }}
            />
          </div>
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/40 sticky top-0 bg-background/95 backdrop-blur-sm z-10">
            <div className="flex items-center gap-2">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center"
                style={{ background: "hsl(var(--kf-accent1)/0.12)" }}
              >
                <CalendarDays
                  className="w-4 h-4"
                  style={{ color: "hsl(var(--kf-accent1))" }}
                />
              </div>
              <h3 className="text-sm font-semibold">{taskLabel}</h3>
            </div>
            <button
              onClick={onClose}
              className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center hover:bg-muted/50 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>
          {crossModuleOrigin && (
            <div className="px-4 pt-3 pb-1">
              <TaskContinuityHeader
                taskLabel={taskLabel}
                returnLabel={`Back to ${crossModuleOrigin.label}`}
                returnHref={crossModuleOrigin.route}
                onBack={handleReturnToOrigin}
              />
            </div>
          )}
          <div className="p-1">
            <BookingForm
              services={services}
              staff={staff}
              contacts={contacts}
              onSubmit={onSubmit}
              onCancel={onClose}
              formError={formError}
              defaultDate={defaultDate}
              defaultTime={defaultTime}
              defaultContactId={defaultContactId}
              saving={saving}
            />
          </div>
        </motion.div>
      ) : (
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="relative w-full max-w-lg h-full bg-background border-l border-border/60 overflow-y-auto"
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-border/40 sticky top-0 bg-background/95 backdrop-blur-sm z-10">
            <div className="flex items-center gap-2">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center"
                style={{ background: "hsl(var(--kf-accent1)/0.12)" }}
              >
                <CalendarDays
                  className="w-4 h-4"
                  style={{ color: "hsl(var(--kf-accent1))" }}
                />
              </div>
              <h3 className="text-sm font-semibold">{taskLabel}</h3>
            </div>
            <button
              onClick={onClose}
              className="min-w-[44px] min-h-[44px] rounded-lg flex items-center justify-center hover:bg-muted/50 transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
          {crossModuleOrigin && (
            <div className="px-4 pt-3 pb-1">
              <TaskContinuityHeader
                taskLabel={taskLabel}
                returnLabel={`Back to ${crossModuleOrigin.label}`}
                returnHref={crossModuleOrigin.route}
                onBack={handleReturnToOrigin}
              />
            </div>
          )}
          <div className="p-1">
            <BookingForm
              services={services}
              staff={staff}
              contacts={contacts}
              onSubmit={onSubmit}
              onCancel={onClose}
              formError={formError}
              defaultDate={defaultDate}
              defaultTime={defaultTime}
              defaultContactId={defaultContactId}
              saving={saving}
            />
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}
