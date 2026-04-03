"use client";

import { useState, useEffect } from "react";
import {
  Calendar,
  Clock,
  User,
  CheckCircle2,
  Loader2,
  ArrowLeft,
  ArrowRight,
  Plus,
  Minus,
  AlertTriangle,
  ShoppingBag,
  CalendarDays,
  UserCircle,
  ClipboardCheck,
  ShieldCheck,
  Lock,
  Package,
} from "lucide-react";
import { formatPrice } from "@/lib/format";
import type { CartItem, Staff, Business, ServiceBookingData } from "./types";
import { getAvailableSlots, isDayClosed, typeBadge } from "./utils";

type Props = {
  business: Business;
  cart: CartItem[];
  staff: Staff[];
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  cartTotal: number;
  cartCurrency: string;
  onBack: () => void;
  onUpdateQuantity: (itemId: string, itemType: string, delta: number) => void;
  onSubmit: (data: {
    serviceBookings: Record<string, ServiceBookingData>;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  }) => Promise<void>;
};

const stepIcons = {
  review: ShoppingBag,
  booking: CalendarDays,
  details: UserCircle,
  confirm: ClipboardCheck,
};

export function CheckoutFlow({
  business,
  cart,
  staff,
  primaryColor,
  secondaryColor,
  accentColor,
  cartTotal,
  cartCurrency,
  onBack,
  onUpdateQuantity,
  onSubmit,
}: Props) {
  const [checkoutStep, setCheckoutStep] = useState(0);
  const [serviceBookings, setServiceBookings] = useState<Record<string, ServiceBookingData>>({});
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepDirection, setStepDirection] = useState<"forward" | "back">("forward");

  const serviceItemsInCart = cart.filter((c) => c.requiresBooking);

  const checkoutSteps = (() => {
    const steps: { key: string; label: string }[] = [{ key: "review", label: "Review" }];
    if (serviceItemsInCart.length > 0) steps.push({ key: "booking", label: "Schedule" });
    steps.push({ key: "details", label: "Details" });
    steps.push({ key: "confirm", label: "Confirm" });
    return steps;
  })();

  useEffect(() => {
    if (checkoutStep >= checkoutSteps.length) {
      setCheckoutStep(Math.max(0, checkoutSteps.length - 1));
    }
  }, [checkoutSteps.length, checkoutStep]);

  const canProceedStep = (() => {
    const stepKey = checkoutSteps[checkoutStep]?.key;
    if (stepKey === "review") return cart.length > 0;
    if (stepKey === "booking") {
      return serviceItemsInCart.every((si) => {
        const bd = serviceBookings[`${si.id}_${si.itemType}`];
        return bd && bd.date && bd.time;
      });
    }
    if (stepKey === "details") return firstName.trim() !== "" && emailInput.trim() !== "";
    return true;
  })();

  const handleSubmitBooking = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        serviceBookings,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: emailInput.trim(),
        phone: phoneInput.trim(),
      });
    } catch (e: any) {
      setError(e?.message || "Something went wrong. Please try again.");
      setSubmitting(false);
    }
  };

  const goNext = () => {
    setStepDirection("forward");
    setCheckoutStep((s) => s + 1);
  };

  const goBack = () => {
    setStepDirection("back");
    if (checkoutStep === 0) onBack();
    else setCheckoutStep((s) => s - 1);
  };

  const currentStepKey = checkoutSteps[checkoutStep]?.key;

  return (
    <div className="min-h-screen relative">
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          background: `radial-gradient(ellipse at top center, ${primaryColor}12 0%, transparent 50%)`,
        }}
      />

      <div className="relative max-w-2xl mx-auto px-4 py-8 space-y-6">
        <button
          onClick={goBack}
          className="flex items-center gap-2 text-sm text-white/40 hover:text-white/80 transition-all duration-200 group"
        >
          <ArrowLeft className="w-4 h-4 transition-transform duration-200 group-hover:-translate-x-1" />
          {checkoutStep === 0 ? "Back to Shop" : "Previous Step"}
        </button>

        <div className="relative">
          <div className="absolute top-4 left-0 right-0 h-[2px] bg-white/[0.04] mx-12 sm:mx-16" />
          <div
            className="absolute top-4 left-0 h-[2px] mx-12 sm:mx-16 transition-all duration-500 ease-out rounded-full"
            style={{
              backgroundColor: primaryColor,
              width: `${(checkoutStep / (checkoutSteps.length - 1)) * 100}%`,
              maxWidth: "calc(100% - 6rem)",
              boxShadow: `0 0 8px ${primaryColor}40`,
            }}
          />

          <div className="relative flex justify-between">
            {checkoutSteps.map((step, idx) => {
              const StepIcon = stepIcons[step.key as keyof typeof stepIcons] || ShoppingBag;
              const isComplete = idx < checkoutStep;
              const isCurrent = idx === checkoutStep;
              const isFuture = idx > checkoutStep;

              return (
                <div key={step.key} className="flex flex-col items-center gap-2 z-10">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300"
                    style={{
                      backgroundColor: isComplete
                        ? primaryColor
                        : isCurrent
                        ? `${primaryColor}20`
                        : "rgba(255,255,255,0.04)",
                      border: isCurrent ? `2px solid ${primaryColor}` : "2px solid transparent",
                      boxShadow: isComplete ? `0 0 12px ${primaryColor}30` : isCurrent ? `0 0 16px ${primaryColor}20` : "none",
                      color: isComplete ? "#fff" : isCurrent ? primaryColor : "rgba(255,255,255,0.2)",
                      transform: isCurrent ? "scale(1.1)" : "scale(1)",
                    }}
                  >
                    {isComplete ? <CheckCircle2 className="w-4 h-4" /> : <StepIcon className="w-3.5 h-3.5" />}
                  </div>
                  <span
                    className="text-[10px] sm:text-xs font-medium transition-all duration-300"
                    style={{
                      color: isCurrent ? "rgba(255,255,255,0.9)" : isComplete ? primaryColor : "rgba(255,255,255,0.25)",
                    }}
                  >
                    {step.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div
          key={currentStepKey}
          style={{
            animation: `${stepDirection === "forward" ? "stepForward" : "stepBack"} 350ms cubic-bezier(0.16,1,0.3,1)`,
          }}
        >
          {currentStepKey === "review" && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${primaryColor}12` }}>
                  <ShoppingBag className="w-5 h-5" style={{ color: primaryColor }} />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white">Review Your Cart</h2>
                  <p className="text-xs text-white/40">{cart.length} {cart.length === 1 ? "item" : "items"} selected</p>
                </div>
              </div>

              {cart.map((item, idx) => {
                const badge = typeBadge(item.itemType, primaryColor, secondaryColor, accentColor);
                return (
                  <div
                    key={`${item.id}_${item.itemType}`}
                    className="rounded-2xl border border-white/[0.06] p-4 flex items-center gap-4 transition-all duration-200 hover:border-white/[0.1] group"
                    style={{
                      background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
                      animationDelay: `${idx * 60}ms`,
                    }}
                  >
                    {item.imageUrl ? (
                      <img src={item.imageUrl} alt={item.name} className="w-16 h-16 rounded-xl object-cover flex-shrink-0 ring-1 ring-white/10" />
                    ) : (
                      <div className="w-16 h-16 rounded-xl flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${badge.color}10` }}>
                        <Package className="w-6 h-6" style={{ color: badge.color, opacity: 0.5 }} />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[9px] font-semibold tracking-wide uppercase"
                          style={{ backgroundColor: `${badge.color}15`, color: badge.color }}
                        >
                          {badge.label}
                        </span>
                        {item.requiresBooking && (
                          <span className="text-[9px] text-amber-400/80 flex items-center gap-0.5">
                            <AlertTriangle className="w-2.5 h-2.5" /> Booking
                          </span>
                        )}
                      </div>
                      <h4 className="font-medium text-sm text-white/90 truncate">{item.name}</h4>
                      <p className="text-[11px] text-white/35 mt-0.5">
                        {formatPrice(item.price, item.currency)}
                        {item.duration ? ` · ${item.duration} min` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => onUpdateQuantity(item.id, item.itemType, -1)}
                        className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] flex items-center justify-center transition-all active:scale-90"
                        aria-label={`Decrease quantity of ${item.name}`}
                      >
                        <Minus className="w-3 h-3 text-white/50" />
                      </button>
                      <span className="text-sm font-semibold w-6 text-center tabular-nums text-white/90">{item.quantity}</span>
                      <button
                        onClick={() => onUpdateQuantity(item.id, item.itemType, 1)}
                        className="w-7 h-7 rounded-lg bg-white/[0.04] hover:bg-white/[0.08] flex items-center justify-center transition-all active:scale-90"
                        aria-label={`Increase quantity of ${item.name}`}
                      >
                        <Plus className="w-3 h-3 text-white/50" />
                      </button>
                    </div>
                    <div className="text-sm font-bold whitespace-nowrap tabular-nums" style={{ color: primaryColor }}>
                      {formatPrice(item.price * item.quantity, item.currency)}
                    </div>
                  </div>
                );
              })}

              <div
                className="rounded-2xl border p-4 flex justify-between items-center"
                style={{
                  borderColor: `${primaryColor}20`,
                  background: `linear-gradient(135deg, ${primaryColor}08 0%, ${primaryColor}03 100%)`,
                }}
              >
                <span className="font-medium text-white/70">Subtotal</span>
                <span className="text-xl font-bold tabular-nums" style={{ color: primaryColor }}>
                  {formatPrice(cartTotal, cartCurrency)}
                </span>
              </div>
            </div>
          )}

          {currentStepKey === "booking" && (
            <div className="space-y-6">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${primaryColor}12` }}>
                  <CalendarDays className="w-5 h-5" style={{ color: primaryColor }} />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white">Schedule Your Services</h2>
                  <p className="text-xs text-white/40">Pick a date and time for each service</p>
                </div>
              </div>

              {serviceItemsInCart.map((si, idx) => {
                const key = `${si.id}_${si.itemType}`;
                const bd = serviceBookings[key] || {
                  serviceId: si.sourceServiceId || si.id,
                  serviceName: si.name,
                  staffId: "",
                  date: "",
                  time: "",
                };
                const slots = getAvailableSlots(bd.date, business.businessHours);
                const closed = isDayClosed(bd.date, business.businessHours);
                const updateBd = (patch: Partial<ServiceBookingData>) => {
                  setServiceBookings((prev) => ({ ...prev, [key]: { ...bd, ...patch } }));
                };

                const isScheduled = bd.date && bd.time;

                return (
                  <div
                    key={key}
                    className="rounded-2xl border border-white/[0.06] overflow-hidden transition-all duration-200"
                    style={{
                      background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)",
                    }}
                  >
                    <div
                      className="px-5 py-3.5 flex items-center justify-between border-b border-white/[0.04]"
                      style={{ background: isScheduled ? `${primaryColor}06` : "transparent" }}
                    >
                      <div className="flex items-center gap-2.5">
                        {isScheduled ? (
                          <CheckCircle2 className="w-4 h-4" style={{ color: primaryColor }} />
                        ) : (
                          <Clock className="w-4 h-4 text-white/30" />
                        )}
                        <h3 className="font-medium text-sm text-white/90">{si.name}</h3>
                        {si.quantity > 1 && (
                          <span className="text-[10px] text-white/40 bg-white/[0.04] px-1.5 py-0.5 rounded">
                            x{si.quantity}
                          </span>
                        )}
                      </div>
                      {isScheduled && (
                        <span className="text-[10px] font-medium px-2 py-1 rounded-lg" style={{ backgroundColor: `${primaryColor}15`, color: primaryColor }}>
                          Scheduled
                        </span>
                      )}
                    </div>

                    <div className="p-5 space-y-4">
                      {staff.length > 0 && (
                        <div className="space-y-2.5">
                          <label className="text-[10px] uppercase tracking-widest text-white/30 flex items-center gap-1.5 font-medium">
                            <User className="w-3 h-3" /> Staff Preference
                          </label>
                          <div className="flex gap-2 flex-wrap">
                            <button
                              type="button"
                              onClick={() => updateBd({ staffId: "" })}
                              className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-all duration-200"
                              style={{
                                borderColor: !bd.staffId ? `${primaryColor}40` : "rgba(255,255,255,0.06)",
                                backgroundColor: !bd.staffId ? `${primaryColor}10` : "rgba(255,255,255,0.02)",
                                color: !bd.staffId ? primaryColor : "rgba(255,255,255,0.5)",
                              }}
                            >
                              <User className="w-3.5 h-3.5" /> Any Available
                            </button>
                            {staff.map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                onClick={() => updateBd({ staffId: s.id })}
                                className="flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-all duration-200"
                                style={{
                                  borderColor: bd.staffId === s.id ? `${secondaryColor}40` : "rgba(255,255,255,0.06)",
                                  backgroundColor: bd.staffId === s.id ? `${secondaryColor}10` : "rgba(255,255,255,0.02)",
                                  color: bd.staffId === s.id ? secondaryColor : "rgba(255,255,255,0.5)",
                                }}
                              >
                                <div
                                  className="h-5 w-5 rounded-full flex items-center justify-center text-[9px] font-bold"
                                  style={{ backgroundColor: `${secondaryColor}20`, color: secondaryColor }}
                                >
                                  {s.name.charAt(0).toUpperCase()}
                                </div>
                                {s.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="space-y-2.5">
                        <label className="text-[10px] uppercase tracking-widest text-white/30 flex items-center gap-1.5 font-medium">
                          <Calendar className="w-3 h-3" /> Date
                        </label>
                        <input
                          type="date"
                          value={bd.date}
                          onChange={(e) => updateBd({ date: e.target.value, time: "" })}
                          min={new Date().toISOString().split("T")[0]}
                          className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-white focus:outline-none transition-all duration-200"
                          style={{
                            borderColor: bd.date ? `${primaryColor}30` : undefined,
                          }}
                        />
                      </div>

                      {bd.date && closed && (
                        <div className="rounded-xl border border-red-500/20 bg-red-500/[0.04] px-4 py-3 text-sm text-red-300 flex items-center gap-2">
                          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                          Closed on{" "}
                          {new Date(bd.date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" })}
                          s. Please pick another date.
                        </div>
                      )}

                      {bd.date && !closed && slots.length > 0 && (
                        <div className="space-y-2.5">
                          <label className="text-[10px] uppercase tracking-widest text-white/30 flex items-center gap-1.5 font-medium">
                            <Clock className="w-3 h-3" /> Available Times
                          </label>
                          <div
                            className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 max-h-[200px] overflow-y-auto pr-1"
                            style={{ scrollbarWidth: "thin" }}
                          >
                            {slots.map((slot) => (
                              <button
                                key={slot}
                                type="button"
                                onClick={() => updateBd({ time: slot })}
                                className="px-2 py-2.5 rounded-lg text-xs font-medium border transition-all duration-200 active:scale-95"
                                style={
                                  bd.time === slot
                                    ? {
                                        backgroundColor: primaryColor,
                                        borderColor: primaryColor,
                                        color: "#fff",
                                        boxShadow: `0 2px 12px ${primaryColor}30`,
                                      }
                                    : {
                                        borderColor: "rgba(255,255,255,0.06)",
                                        backgroundColor: "rgba(255,255,255,0.02)",
                                        color: "rgba(255,255,255,0.5)",
                                      }
                                }
                              >
                                {slot}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {bd.date && !closed && slots.length === 0 && (
                        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-white/40 text-center">
                          No time slots available for this date.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {currentStepKey === "details" && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${primaryColor}12` }}>
                  <UserCircle className="w-5 h-5" style={{ color: primaryColor }} />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white">Your Details</h2>
                  <p className="text-xs text-white/40">We&apos;ll use this to confirm your booking</p>
                </div>
              </div>

              <div className="rounded-2xl border border-white/[0.06] p-5 space-y-4" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)" }}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-widest text-white/30 font-medium">
                      First Name <span style={{ color: primaryColor }}>*</span>
                    </label>
                    <input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="John"
                      className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none transition-all duration-200"
                      style={{ borderColor: firstName.trim() ? `${primaryColor}25` : undefined }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-widest text-white/30 font-medium">
                      Last Name
                    </label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Doe"
                      className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none transition-all duration-200"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-widest text-white/30 font-medium">
                      Email <span style={{ color: primaryColor }}>*</span>
                    </label>
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="john@example.com"
                      className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none transition-all duration-200"
                      style={{ borderColor: emailInput.trim() ? `${primaryColor}25` : undefined }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] uppercase tracking-widest text-white/30 font-medium">
                      Phone
                    </label>
                    <input
                      type="tel"
                      value={phoneInput}
                      onChange={(e) => setPhoneInput(e.target.value)}
                      placeholder="+1 (555) 000-0000"
                      className="w-full rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-white placeholder:text-white/20 focus:outline-none transition-all duration-200"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 text-[10px] text-white/25 pt-1">
                  <Lock className="w-3 h-3" />
                  <span>Your information is kept private and secure</span>
                </div>
              </div>
            </div>
          )}

          {currentStepKey === "confirm" && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: `${primaryColor}12` }}>
                  <ClipboardCheck className="w-5 h-5" style={{ color: primaryColor }} />
                </div>
                <div>
                  <h2 className="text-xl font-semibold text-white">Confirm Your Order</h2>
                  <p className="text-xs text-white/40">Review everything before submitting</p>
                </div>
              </div>

              <div
                className="rounded-2xl border border-white/[0.06] overflow-hidden"
                style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)" }}
              >
                <div className="px-5 py-3 border-b border-white/[0.04]">
                  <div className="text-[10px] uppercase tracking-widest text-white/30 font-medium">Order Summary</div>
                </div>
                <div className="p-5 space-y-3">
                  {cart.map((item) => (
                    <div key={`${item.id}_${item.itemType}`} className="flex justify-between text-sm items-center">
                      <div className="flex items-center gap-2">
                        <span className="text-white/60">{item.name}</span>
                        <span className="text-[10px] text-white/30 bg-white/[0.04] px-1.5 py-0.5 rounded">x{item.quantity}</span>
                      </div>
                      <span className="text-white font-medium tabular-nums">{formatPrice(item.price * item.quantity, item.currency)}</span>
                    </div>
                  ))}
                  <div className="border-t border-white/[0.06] pt-3 flex justify-between items-center">
                    <span className="text-base font-semibold" style={{ color: primaryColor }}>Total</span>
                    <span className="text-xl font-bold tabular-nums" style={{ color: primaryColor }}>{formatPrice(cartTotal, cartCurrency)}</span>
                  </div>
                </div>
              </div>

              {serviceItemsInCart.length > 0 && (
                <div
                  className="rounded-2xl border border-white/[0.06] overflow-hidden"
                  style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)" }}
                >
                  <div className="px-5 py-3 border-b border-white/[0.04]">
                    <div className="text-[10px] uppercase tracking-widest text-white/30 font-medium flex items-center gap-1.5">
                      <CalendarDays className="w-3 h-3" /> Appointments
                    </div>
                  </div>
                  <div className="p-5 space-y-3">
                    {serviceItemsInCart.map((si) => {
                      const bd = serviceBookings[`${si.id}_${si.itemType}`];
                      if (!bd) return null;
                      const staffMember = staff.find((s) => s.id === bd.staffId);
                      return (
                        <div key={`${si.id}_${si.itemType}`} className="flex items-start justify-between">
                          <div>
                            <div className="text-sm text-white/80 font-medium">{si.name}</div>
                            {staffMember && <div className="text-[11px] text-white/35 mt-0.5">with {staffMember.name}</div>}
                          </div>
                          <div className="text-right">
                            <div className="text-sm text-white/80">
                              {bd.date &&
                                new Date(`${bd.date}T${bd.time || "00:00"}`).toLocaleDateString("en-US", {
                                  weekday: "short",
                                  month: "short",
                                  day: "numeric",
                                })}
                            </div>
                            <div className="text-[11px] font-medium" style={{ color: primaryColor }}>{bd.time}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div
                className="rounded-2xl border border-white/[0.06] overflow-hidden"
                style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0.01) 100%)" }}
              >
                <div className="px-5 py-3 border-b border-white/[0.04]">
                  <div className="text-[10px] uppercase tracking-widest text-white/30 font-medium flex items-center gap-1.5">
                    <UserCircle className="w-3 h-3" /> Contact Info
                  </div>
                </div>
                <div className="p-5">
                  <div className="text-sm text-white/80 font-medium">{firstName} {lastName}</div>
                  <div className="text-[11px] text-white/40 mt-1">{emailInput}</div>
                  {phoneInput && <div className="text-[11px] text-white/40">{phoneInput}</div>}
                </div>
              </div>

              <div
                className="rounded-2xl border border-white/[0.04] p-4 flex items-center justify-between gap-3"
                style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.03) 0%, rgba(16,185,129,0.01) 100%)" }}
              >
                {[
                  { icon: ShieldCheck, label: "Secure" },
                  { icon: Lock, label: "Encrypted" },
                  { icon: CheckCircle2, label: "Verified" },
                ].map(({ icon: Icon, label }) => (
                  <div key={label} className="flex items-center gap-1.5 text-[11px] text-emerald-400/60">
                    <Icon className="w-3.5 h-3.5" />
                    <span>{label}</span>
                  </div>
                ))}
              </div>

              {error && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] px-4 py-3 text-sm text-red-300 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                  {error}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-3 pt-2">
          {checkoutStep > 0 && (
            <button
              onClick={goBack}
              className="flex-1 py-3.5 rounded-2xl border border-white/[0.06] text-sm font-medium text-white/60 hover:bg-white/[0.03] hover:text-white/80 transition-all duration-200 active:scale-[0.98]"
            >
              Back
            </button>
          )}
          {checkoutStep < checkoutSteps.length - 1 ? (
            <button
              onClick={goNext}
              disabled={!canProceedStep}
              className="flex-1 py-3.5 rounded-2xl text-white text-sm font-semibold transition-all duration-300 hover:scale-[1.01] active:scale-[0.98] disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2 group"
              style={{ backgroundColor: primaryColor, boxShadow: canProceedStep ? `0 4px 20px ${primaryColor}25` : "none" }}
            >
              Continue
              <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </button>
          ) : (
            <button
              onClick={handleSubmitBooking}
              disabled={submitting || !canProceedStep}
              className="flex-1 py-4 rounded-2xl text-white font-semibold text-sm transition-all duration-300 hover:scale-[1.01] active:scale-[0.98] hover:shadow-lg disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100 relative overflow-hidden group"
              style={{ backgroundColor: primaryColor, boxShadow: `0 8px 32px ${primaryColor}30` }}
            >
              <span
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{
                  background: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.08) 50%, transparent 100%)`,
                }}
              />
              {submitting ? (
                <span className="relative flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Processing...
                </span>
              ) : (
                <span className="relative flex items-center justify-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  {serviceItemsInCart.length > 0 ? "Confirm Booking" : "Place Order"}
                </span>
              )}
            </button>
          )}
        </div>

        <div className="flex items-center justify-center gap-1.5 text-[10px] text-white/20 pb-4">
          <Lock className="w-3 h-3" />
          <span>Powered by KeyFlowOS · Secure Checkout</span>
        </div>
      </div>

      <style jsx>{`
        @keyframes stepForward {
          from { opacity: 0; transform: translateX(24px); }
          to { opacity: 1; transform: translateX(0); }
        }
        @keyframes stepBack {
          from { opacity: 0; transform: translateX(-24px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
